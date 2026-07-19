import { createHash } from "node:crypto"
import { mkdir, unlink, writeFile } from "node:fs/promises"
import ExcelJS from "exceljs"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionIncidentHistory,
  preventionIncidentImportBatches,
  preventionIncidentImportRows,
  preventionIncidentNotifications,
  preventionIncidentPeople,
  preventionIncidentPersonSensitivePayloads,
  preventionIncidents,
  workers,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { SFTI_INCIDENT_DICTIONARY } from "@/lib/prevention/incidents"
import {
  decryptPreventionPayload,
  encryptPreventionBuffer,
  encryptPreventionPayload,
} from "@/lib/security/prevention-field-encryption"
import type { IncidentAccess, IncidentEventType } from "@/lib/services/prevention-incidents"
import {
  incidentNotificationDeadline,
  requiredIncidentNotificationTypes,
} from "@/lib/services/prevention-incidents"
import {
  createPreventionSensitiveFilePath,
  resolvePreventionSensitiveFilesDir,
  resolvePreventionSensitiveFile,
} from "@/lib/storage/config"

const MAX_IMPORT_BYTES = 20 * 1024 * 1024

type DictionaryKey = typeof SFTI_INCIDENT_DICTIONARY[number]["key"]

interface NormalizedIncidentImportRow {
  externalId: string | null
  worksiteReference: string
  eventType: IncidentEventType | null
  occurredAt: string | null
  knownAt: string | null
  companyName: string
  location: string
  narrative: string
  actualSeverity: "none" | "minor" | "medical_treatment" | "lost_time" | "serious" | "fatal"
  potentialSeverity: "low" | "medium" | "high" | "critical" | "fatal"
  isFatalOrSerious: boolean
  immediateMeasures: string | null
  operationsSuspended: boolean
  hasSensitivePerson: boolean
}

type OriginalIncidentImportRow = Record<string, unknown>

const resolveRowSchema = z.object({
  rowId: z.string().min(1),
  worksiteId: z.string().min(1),
  eventType: z.enum([
    "dangerous_incident",
    "work_accident",
    "commute_accident",
    "suspected_occupational_disease",
    "material_damage",
    "environmental_spill",
    "vehicle_event",
    "contractor_or_third_party",
  ]),
  reason: z.string().trim().min(5).max(2000),
})

function hasPermission(access: IncidentAccess, permission: string) {
  return access.permissions.includes(permission)
}

function scopeAllows(access: IncidentAccess, worksiteId: string) {
  return access.scope.mode === "all" || (access.scope.mode === "some" && access.scope.ids.includes(worksiteId))
}

function requireImportPermission(access: IncidentAccess, approval = false) {
  const permission = approval ? "prevention:incidents:close" : "prevention:incidents:triage"
  if (!hasPermission(access, permission) || !hasPermission(access, "prevention:incidents:view_sensitive")) {
    throw new Error("Lote SFTI no encontrado o fuera de alcance.")
  }
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value !== "object") return value
  if ("result" in value && value.result !== undefined) return cellValue(value.result as ExcelJS.CellValue)
  if ("text" in value && typeof value.text === "string") return value.text
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("")
  return String(value)
}

function valueText(value: unknown) {
  if (value instanceof Date) return value.toISOString()
  return String(value ?? "").trim()
}

function booleanValue(value: unknown) {
  const normalized = normalizeHeader(value)
  return ["1", "si", "sí", "true", "x", "yes"].includes(normalized)
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30))
    const date = new Date(excelEpoch.getTime() + value * 86_400_000)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const text = valueText(value)
  if (!text) return null
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  const match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (!match) return null
  const [, day, month, year, hour = "0", minute = "0"] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function eventTypeValue(value: unknown): IncidentEventType | null {
  const normalized = normalizeHeader(value).replace(/[/_-]+/g, " ")
  const mappings: Array<[RegExp, IncidentEventType]> = [
    [/enfermedad|diep/, "suspected_occupational_disease"],
    [/trayecto/, "commute_accident"],
    [/accidente.*trabajo|laboral/, "work_accident"],
    [/incidente|suceso|cuasi/, "dangerous_incident"],
    [/ambiental|derrame/, "environmental_spill"],
    [/vehicular|vehiculo|transito/, "vehicle_event"],
    [/material/, "material_damage"],
    [/contratista|tercero/, "contractor_or_third_party"],
  ]
  return mappings.find(([pattern]) => pattern.test(normalized))?.[1] ?? null
}

function actualSeverityValue(value: unknown): NormalizedIncidentImportRow["actualSeverity"] {
  const normalized = normalizeHeader(value)
  if (/fatal|muerte/.test(normalized)) return "fatal"
  if (/grave/.test(normalized)) return "serious"
  if (/tiempo perdido|con baja|reposo/.test(normalized)) return "lost_time"
  if (/tratamiento|medic/.test(normalized)) return "medical_treatment"
  if (/menor|leve/.test(normalized)) return "minor"
  return "none"
}

function potentialSeverityValue(value: unknown): NormalizedIncidentImportRow["potentialSeverity"] {
  const normalized = normalizeHeader(value)
  if (/fatal/.test(normalized)) return "fatal"
  if (/critic/.test(normalized)) return "critical"
  if (/alta|alto|grave/.test(normalized)) return "high"
  if (/media|medio/.test(normalized)) return "medium"
  return "low"
}

function sha256(data: Uint8Array | string) {
  return createHash("sha256").update(data).digest("hex")
}

function rowFingerprint(row: NormalizedIncidentImportRow) {
  return sha256(JSON.stringify({
    externalId: row.externalId,
    worksite: normalizeHeader(row.worksiteReference),
    eventType: row.eventType,
    occurredAt: row.occurredAt,
    company: normalizeHeader(row.companyName),
  }))
}

function resolveColumnMap(headerRow: ExcelJS.Row) {
  const result = new Map<DictionaryKey, number>()
  headerRow.eachCell({ includeEmpty: false }, (cell, column) => {
    const header = normalizeHeader(cellValue(cell.value))
    const definition = SFTI_INCIDENT_DICTIONARY.find((item) => item.aliases.some((alias) => normalizeHeader(alias) === header))
    if (definition && !result.has(definition.key)) result.set(definition.key, column)
  })
  const missing = SFTI_INCIDENT_DICTIONARY.filter((item) => item.required && !result.has(item.key)).map((item) => item.label)
  if (missing.length > 0) throw new Error(`El XLSX SFTI no contiene columnas obligatorias: ${missing.join(", ")}.`)
  return result
}

function readRow(row: ExcelJS.Row, columns: Map<DictionaryKey, number>) {
  const original: OriginalIncidentImportRow = {}
  for (const definition of SFTI_INCIDENT_DICTIONARY) {
    const column = columns.get(definition.key)
    if (!column) continue
    original[definition.key] = cellValue(row.getCell(column).value)
  }
  const actualSeverity = actualSeverityValue(original.actualSeverity)
  const normalized: NormalizedIncidentImportRow = {
    externalId: valueText(original.externalId) || null,
    worksiteReference: valueText(original.worksite),
    eventType: eventTypeValue(original.eventType),
    occurredAt: dateValue(original.occurredAt),
    knownAt: dateValue(original.knownAt),
    companyName: valueText(original.companyName),
    location: valueText(original.location),
    narrative: valueText(original.narrative),
    actualSeverity,
    potentialSeverity: potentialSeverityValue(original.potentialSeverity),
    isFatalOrSerious: booleanValue(original.fatalOrSerious) || ["serious", "fatal"].includes(actualSeverity),
    immediateMeasures: valueText(original.immediateMeasures) || null,
    operationsSuspended: booleanValue(original.operationsSuspended),
    hasSensitivePerson: Boolean(valueText(original.personName) || valueText(original.personIdentifier) || valueText(original.injury) || valueText(original.bodyPart)),
  }
  return { original, normalized }
}

function validateNormalized(row: NormalizedIncidentImportRow) {
  const issues: string[] = []
  if (!row.worksiteReference) issues.push("Faena vacía")
  if (!row.eventType) issues.push("Tipo de evento no reconocido")
  if (!row.occurredAt) issues.push("Fecha/hora de ocurrencia inválida")
  if (!row.knownAt) issues.push("Fecha/hora de conocimiento inválida")
  if (row.occurredAt && row.knownAt && new Date(row.knownAt).getTime() < new Date(row.occurredAt).getTime()) issues.push("Conocimiento anterior a ocurrencia")
  if (row.companyName.length < 2) issues.push("Empresa vacía")
  if (row.location.length < 2) issues.push("Lugar vacío")
  if (row.narrative.length < 10) issues.push("Relato insuficiente")
  if (row.isFatalOrSerious && !row.operationsSuspended) issues.push("Fatal/grave sin suspensión registrada")
  if (row.isFatalOrSerious && (row.immediateMeasures?.length ?? 0) < 10) issues.push("Fatal/grave sin medidas inmediatas suficientes")
  return issues
}

async function safeRemove(path: string) {
  await unlink(path).catch(() => undefined)
}

export async function stageSftiIncidentImport(args: {
  fileName: string
  buffer: Uint8Array
  access: IncidentAccess
}) {
  requireImportPermission(args.access)
  if (!/\.xlsx$/i.test(args.fileName)) throw new Error("La importación SFTI debe ser un archivo XLSX.")
  if (args.buffer.byteLength === 0 || args.buffer.byteLength > MAX_IMPORT_BYTES) throw new Error("El XLSX está vacío o supera 20 MB.")
  const checksum = sha256(args.buffer)
  const [existing] = await db.select().from(preventionIncidentImportBatches)
    .where(eq(preventionIncidentImportBatches.sourceChecksumSha256, checksum)).limit(1)
  if (existing) return { batch: existing, idempotentReplay: true }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(args.buffer) as never)
  const sheet = workbook.worksheets[0]
  if (!sheet || sheet.actualRowCount < 2) throw new Error("El XLSX SFTI no contiene filas de datos.")
  const columns = resolveColumnMap(sheet.getRow(1))
  const activeWorksites = await db.select({ id: worksites.id, name: worksites.name, code: worksites.code })
    .from(worksites).where(eq(worksites.isActive, true))
  const existingSftiIds = await db.select({ id: preventionIncidents.sftiExternalId }).from(preventionIncidents)
    .where(sql`${preventionIncidents.sftiExternalId} IS NOT NULL`)
  const knownExternalIds = new Set(existingSftiIds.map((item) => item.id).filter((value): value is string => Boolean(value)))
  const batchId = `incib-${nanoid()}`
  const sourceEncrypted = encryptPreventionBuffer(args.buffer, `incident-import:${batchId}`)
  const storageName = `${batchId}.xlsx.enc`
  const relativePath = createPreventionSensitiveFilePath(storageName)
  const absoluteDir = resolvePreventionSensitiveFilesDir()
  const absolutePath = resolvePreventionSensitiveFile(relativePath)
  if (!absolutePath) throw new Error("No se pudo resolver el almacenamiento cifrado SFTI.")
  await mkdir(absoluteDir, { recursive: true, mode: 0o700 })
  await writeFile(absolutePath, sourceEncrypted.encryptedBuffer, { mode: 0o600, flag: "wx" })

  try {
    return await db.transaction(async (tx) => {
      const now = new Date().toISOString()
      const rows: Array<typeof preventionIncidentImportRows.$inferInsert> = []
      const counts = { ready: 0, duplicate: 0, needs_review: 0, error: 0 }
      const seenExternalIds = new Set<string>()
      const seenFingerprints = new Set<string>()

      for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        const { original, normalized } = readRow(row, columns)
        if (Object.values(original).every((value) => !valueText(value))) continue
        const issues = validateNormalized(normalized)
        const normalizedWorksite = normalizeHeader(normalized.worksiteReference)
        const worksiteMatches = activeWorksites.filter((worksite) =>
          normalizeHeader(worksite.code) === normalizedWorksite || normalizeHeader(worksite.name) === normalizedWorksite)
        const worksiteId = worksiteMatches.length === 1 ? worksiteMatches[0]?.id ?? null : null
        if (!worksiteId) issues.push(worksiteMatches.length > 1 ? "Faena ambigua" : "Faena no resuelta")
        else if (!scopeAllows(args.access, worksiteId)) issues.push("Faena fuera del alcance del importador")
        const fingerprint = rowFingerprint(normalized)
        const externalDuplicate = Boolean(normalized.externalId && (knownExternalIds.has(normalized.externalId) || seenExternalIds.has(normalized.externalId)))
        const fingerprintDuplicate = seenFingerprints.has(fingerprint)
        let resolutionStatus: "ready" | "duplicate" | "needs_review" | "error"
        if (externalDuplicate || fingerprintDuplicate) resolutionStatus = "duplicate"
        else if (issues.some((issue) => /inválida|anterior|vacía|insuficiente|sin suspensión|sin medidas/.test(issue))) resolutionStatus = "error"
        else if (issues.length > 0) resolutionStatus = "needs_review"
        else resolutionStatus = "ready"
        counts[resolutionStatus]++
        if (normalized.externalId) seenExternalIds.add(normalized.externalId)
        seenFingerprints.add(fingerprint)
        const rowId = `incir-${nanoid()}`
        const encryptedOriginal = encryptPreventionPayload(original, `incident-import-row:${rowId}`)
        rows.push({
          id: rowId,
          batchId,
          rowNumber: rowNumber - 1,
          rowFingerprint: fingerprint,
          sourceExternalId: normalized.externalId,
          originalEncrypted: encryptedOriginal.encryptedPayload,
          originalIv: encryptedOriginal.iv,
          originalAuthTag: encryptedOriginal.authTag,
          originalKeyVersion: encryptedOriginal.keyVersion,
          normalized: normalized as unknown as Record<string, unknown>,
          resolutionStatus,
          worksiteId,
          issues,
          createdAt: now,
          updatedAt: now,
        })
      }
      if (rows.length === 0) throw new Error("El XLSX SFTI no contiene filas utilizables.")
      const [batch] = await tx.insert(preventionIncidentImportBatches).values({
        id: batchId,
        sourceFileName: args.fileName.slice(0, 500),
        sourceChecksumSha256: checksum,
        sourceEncryptedPath: relativePath,
        sourceCiphertextChecksumSha256: sha256(sourceEncrypted.encryptedBuffer),
        sourceIv: sourceEncrypted.iv,
        sourceAuthTag: sourceEncrypted.authTag,
        sourceKeyVersion: sourceEncrypted.keyVersion,
        status: counts.needs_review + counts.error > 0 ? "review" : "staging",
        totalRows: rows.length,
        readyRows: counts.ready,
        duplicateRows: counts.duplicate,
        reviewRows: counts.needs_review,
        errorRows: counts.error,
        importedByUserId: args.access.ctx.userId,
        createdAt: now,
        updatedAt: now,
      }).returning()
      if (!batch) throw new Error("No se pudo crear el lote SFTI.")
      await tx.insert(preventionIncidentImportRows).values(rows)
      return { batch, idempotentReplay: false }
    })
  } catch (error) {
    await safeRemove(absolutePath)
    throw error
  }
}

export async function listSftiIncidentImportBatches(access: IncidentAccess) {
  requireImportPermission(access)
  return db.select().from(preventionIncidentImportBatches).orderBy(asc(preventionIncidentImportBatches.createdAt))
}

export async function getSftiIncidentImportBatch(batchId: string, access: IncidentAccess) {
  requireImportPermission(access)
  const [batch] = await db.select().from(preventionIncidentImportBatches)
    .where(eq(preventionIncidentImportBatches.id, batchId)).limit(1)
  if (!batch) return null
  const rows = await db.select({
    id: preventionIncidentImportRows.id,
    rowNumber: preventionIncidentImportRows.rowNumber,
    sourceExternalId: preventionIncidentImportRows.sourceExternalId,
    normalized: preventionIncidentImportRows.normalized,
    resolutionStatus: preventionIncidentImportRows.resolutionStatus,
    worksiteId: preventionIncidentImportRows.worksiteId,
    workerId: preventionIncidentImportRows.workerId,
    issues: preventionIncidentImportRows.issues,
    incidentId: preventionIncidentImportRows.incidentId,
  }).from(preventionIncidentImportRows)
    .where(eq(preventionIncidentImportRows.batchId, batchId))
    .orderBy(asc(preventionIncidentImportRows.rowNumber))
  if (rows.some((row) => row.worksiteId && !scopeAllows(access, row.worksiteId))) {
    throw new Error("Lote SFTI no encontrado o fuera de alcance.")
  }
  return { batch, rows }
}

export async function resolveSftiIncidentImportRow(args: {
  input: unknown
  access: IncidentAccess
}) {
  requireImportPermission(args.access)
  const input = resolveRowSchema.parse(args.input)
  if (!scopeAllows(args.access, input.worksiteId)) throw new Error("Fila SFTI no encontrada o fuera de alcance.")
  const [worksite] = await db.select({ id: worksites.id }).from(worksites)
    .where(and(eq(worksites.id, input.worksiteId), eq(worksites.isActive, true))).limit(1)
  if (!worksite) throw new Error("Fila SFTI no encontrada o fuera de alcance.")
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(preventionIncidentImportRows)
      .where(eq(preventionIncidentImportRows.id, input.rowId)).limit(1)
    if (!row || !["needs_review", "error"].includes(row.resolutionStatus)) throw new Error("Fila SFTI no encontrada o no editable.")
    const normalized = row.normalized as unknown as NormalizedIncidentImportRow
    const corrected = { ...normalized, worksiteReference: input.worksiteId, eventType: input.eventType }
    const remainingIssues = validateNormalized(corrected)
    const resolutionStatus = remainingIssues.length === 0 ? "ready" : "error"
    const now = new Date().toISOString()
    await tx.update(preventionIncidentImportRows).set({
      normalized: corrected as unknown as Record<string, unknown>,
      worksiteId: input.worksiteId,
      resolutionStatus,
      issues: remainingIssues.length > 0 ? remainingIssues : [`Revisada: ${input.reason}`],
      reviewedByUserId: args.access.ctx.userId,
      reviewedAt: now,
      updatedAt: now,
    }).where(eq(preventionIncidentImportRows.id, row.id))
    await refreshBatchCounts(tx, row.batchId, now)
    return { ok: true, resolutionStatus }
  })
}

async function refreshBatchCounts(client: Parameters<Parameters<typeof db.transaction>[0]>[0], batchId: string, now: string) {
  const rows = await client.select({ status: preventionIncidentImportRows.resolutionStatus })
    .from(preventionIncidentImportRows).where(eq(preventionIncidentImportRows.batchId, batchId))
  const count = (status: string) => rows.filter((row) => row.status === status).length
  await client.update(preventionIncidentImportBatches).set({
    readyRows: count("ready") + count("approved"),
    duplicateRows: count("duplicate"),
    reviewRows: count("needs_review"),
    errorRows: count("error"),
    activatedRows: count("activated"),
    updatedAt: now,
  }).where(eq(preventionIncidentImportBatches.id, batchId))
}

export async function approveSftiIncidentImportBatch(batchId: string, access: IncidentAccess) {
  requireImportPermission(access, true)
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(preventionIncidentImportBatches)
      .where(eq(preventionIncidentImportBatches.id, batchId)).limit(1)
    if (!batch || !["staging", "review"].includes(batch.status)) throw new Error("Lote SFTI no encontrado o no aprobable.")
    const rows = await tx.select().from(preventionIncidentImportRows)
      .where(eq(preventionIncidentImportRows.batchId, batchId))
    const actionable = rows.filter((row) => !["duplicate"].includes(row.resolutionStatus))
    if (actionable.length === 0) throw new Error("El lote no contiene filas nuevas para aprobar.")
    if (actionable.some((row) => row.resolutionStatus !== "ready")) throw new Error("Debes resolver todas las filas con error o revisión antes de aprobar.")
    if (actionable.some((row) => !row.worksiteId || !scopeAllows(access, row.worksiteId))) throw new Error("El lote contiene faenas fuera de alcance.")
    const now = new Date().toISOString()
    await tx.update(preventionIncidentImportRows).set({ resolutionStatus: "approved", updatedAt: now })
      .where(and(eq(preventionIncidentImportRows.batchId, batchId), eq(preventionIncidentImportRows.resolutionStatus, "ready")))
    const [updated] = await tx.update(preventionIncidentImportBatches).set({
      status: "approved",
      approvedByUserId: access.ctx.userId,
      approvedAt: now,
      reconciliation: {
        total: rows.length,
        approved: actionable.length,
        duplicates: rows.length - actionable.length,
      },
      updatedAt: now,
    }).where(eq(preventionIncidentImportBatches.id, batchId)).returning()
    return updated
  })
}

function incidentCode() {
  return `INC-${new Date().getUTCFullYear()}-${nanoid(10).toUpperCase()}`
}

async function activateImportRow(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  row: typeof preventionIncidentImportRows.$inferSelect,
  actorUserId: string,
  now: string,
) {
  if (!row.worksiteId) throw new Error(`Fila ${row.rowNumber}: falta faena.`)
  const normalized = row.normalized as unknown as NormalizedIncidentImportRow
  if (!normalized.eventType || !normalized.occurredAt || !normalized.knownAt) throw new Error(`Fila ${row.rowNumber}: normalización incompleta.`)
  const clientSubmissionId = normalized.externalId ? `sfti:${normalized.externalId}` : `sfti-row:${row.rowFingerprint}`
  const incidentId = `inc-${nanoid()}`
  const [created] = await tx.insert(preventionIncidents).values({
    id: incidentId,
    code: incidentCode(),
    clientSubmissionId,
    sftiExternalId: normalized.externalId,
    worksiteId: row.worksiteId,
    companyName: normalized.companyName,
    eventType: normalized.eventType,
    status: "reported",
    occurredAt: normalized.occurredAt,
    knownAt: normalized.knownAt,
    location: normalized.location,
    initialNarrative: normalized.narrative,
    reportedByUserId: actorUserId,
    actualSeverity: normalized.actualSeverity,
    potentialSeverity: normalized.potentialSeverity,
    immediateMeasures: normalized.immediateMeasures,
    operationsSuspended: normalized.operationsSuspended,
    isFatalOrSerious: normalized.isFatalOrSerious,
    source: "sfti_import",
    importRowId: row.id,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: preventionIncidents.clientSubmissionId }).returning()
  let incident = created
  if (!incident) {
    const [existing] = await tx.select().from(preventionIncidents)
      .where(eq(preventionIncidents.clientSubmissionId, clientSubmissionId)).limit(1)
    if (!existing) throw new Error(`Fila ${row.rowNumber}: colisión idempotente no conciliable.`)
    incident = existing
  }

  if (created) {
    const knownAt = normalized.knownAt
    const notificationTypes = requiredIncidentNotificationTypes({
      eventType: normalized.eventType,
      isFatalOrSerious: normalized.isFatalOrSerious,
    })
    if (notificationTypes.length > 0) {
      const deadline = incidentNotificationDeadline(knownAt)
      await tx.insert(preventionIncidentNotifications).values(notificationTypes.map((type) => ({
        id: `incn-${nanoid()}`,
        incidentId: incident.id,
        notificationType: type,
        deadlineAt: type === "diat" || type === "diep" ? deadline : type === "restart_authorization" ? null : knownAt,
        status: type === "restart_authorization" ? "pending" : (new Date(now).getTime() > new Date(type === "diat" || type === "diep" ? deadline : knownAt).getTime() ? "overdue" : "pending"),
        escalatedAt: new Date(now).getTime() > new Date(type === "diat" || type === "diep" ? deadline : knownAt).getTime() ? now : null,
        createdAt: now,
        updatedAt: now,
      })))
    }

    const original = decryptPreventionPayload<OriginalIncidentImportRow>({
      encryptedPayload: row.originalEncrypted,
      iv: row.originalIv,
      authTag: row.originalAuthTag,
      keyVersion: row.originalKeyVersion,
    }, `incident-import-row:${row.id}`)
    if (normalized.hasSensitivePerson) {
      const identifier = valueText(original.personIdentifier)
      const matchingWorkers = identifier
        ? await tx.select({ id: workers.id }).from(workers).where(and(eq(workers.rut, identifier), eq(workers.worksiteId, row.worksiteId)))
        : []
      const personId = `incp-${nanoid()}`
      await tx.insert(preventionIncidentPeople).values({
        id: personId,
        incidentId: incident.id,
        workerId: matchingWorkers.length === 1 ? matchingWorkers[0]?.id ?? null : null,
        displayLabel: matchingWorkers.length === 1 ? "Trabajador vinculado" : "Persona importada desde SFTI",
        employerName: normalized.companyName,
        relationshipType: "employee",
        absenceAtLeastNormalShift: normalized.actualSeverity === "lost_time",
        createdAt: now,
        updatedAt: now,
      })
      const encrypted = encryptPreventionPayload({
        fullName: valueText(original.personName) || undefined,
        nationalIdentifier: identifier || undefined,
        injuryDescription: valueText(original.injury) || undefined,
        affectedBodyPart: valueText(original.bodyPart) || undefined,
      }, `incident-person:${personId}`)
      await tx.insert(preventionIncidentPersonSensitivePayloads).values({
        id: `incps-${nanoid()}`,
        personId,
        ...encrypted,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
        createdAt: now,
        updatedAt: now,
      })
    }
    await tx.insert(preventionIncidentHistory).values({
      id: `inch-${nanoid()}`,
      incidentId: incident.id,
      changeType: "import",
      toStatus: "reported",
      reason: "Activación de staging SFTI aprobado",
      changeSet: { importRowId: row.id, batchId: row.batchId, sourceExternalId: row.sourceExternalId },
      actorUserId,
      createdAt: now,
    })
  }
  await tx.update(preventionIncidentImportRows).set({
    resolutionStatus: "activated",
    incidentId: incident.id,
    updatedAt: now,
  }).where(eq(preventionIncidentImportRows.id, row.id))
  return incident
}

export async function activateSftiIncidentImportBatch(batchId: string, access: IncidentAccess) {
  requireImportPermission(access, true)
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(preventionIncidentImportBatches)
      .where(eq(preventionIncidentImportBatches.id, batchId)).limit(1)
    if (!batch || !["approved", "activated"].includes(batch.status)) throw new Error("Lote SFTI no encontrado o no activable.")
    const rows = await tx.select().from(preventionIncidentImportRows)
      .where(and(eq(preventionIncidentImportRows.batchId, batchId), inArray(preventionIncidentImportRows.resolutionStatus, ["approved", "activated"])))
      .orderBy(asc(preventionIncidentImportRows.rowNumber))
    if (rows.some((row) => !row.worksiteId || !scopeAllows(access, row.worksiteId))) throw new Error("El lote contiene faenas fuera de alcance.")
    const now = new Date().toISOString()
    const activatedIds: string[] = []
    for (const row of rows) {
      if (row.resolutionStatus === "activated" && row.incidentId) {
        activatedIds.push(row.incidentId)
        continue
      }
      const incident = await activateImportRow(tx, row, access.ctx.userId, now)
      activatedIds.push(incident.id)
    }
    await tx.update(preventionIncidentImportBatches).set({
      status: "activated",
      activatedByUserId: batch.activatedByUserId ?? access.ctx.userId,
      activatedAt: batch.activatedAt ?? now,
      activatedRows: activatedIds.length,
      updatedAt: now,
    }).where(eq(preventionIncidentImportBatches.id, batch.id))
    return { batchId, activatedIds, idempotentReplay: batch.status === "activated" }
  })
}

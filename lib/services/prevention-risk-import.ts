import { createHash } from "node:crypto"
import ExcelJS from "exceljs"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { z, ZodError } from "zod"
import { db } from "@/db"
import {
  preventionRiskImportBatches,
  preventionRiskImportRows,
  preventionRiskMatrices,
  worksites,
} from "@/db/schema"
import { recordModuleHistory } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import type { RiskLegalAccess } from "@/lib/services/prevention-risk-legal"
import {
  createRiskMatrixDraftWithClient,
  addRiskEntryWithClient,
} from "@/lib/services/prevention-risk-legal"
import { mkdirp, removeFile, writeBuffer } from "@/lib/storage/helpers"
import { resolveRiskImportsDir, resolveStorageFile } from "@/lib/storage/config"
import { riskEntrySchema } from "@/lib/validation/prevention-module/risk-legal"
import { validateLoadedWorkbook, validateXlsxEnvelope } from "@/lib/services/xlsx-security"

export const RISK_IMPORT_MAX_BYTES = 20 * 1024 * 1024
const MAX_ROWS = 5_000
/* Los topes de expansión del validador compartido están calibrados para los
 * 15 MB de PDTP (80 MB descomprimidos, 20 MB por entrada). MIPER admite 20 MB
 * de archivo y 5.000 filas: con los defaults, un libro legítimo cerca de su
 * techo se rechazaba por expansión —o su `sheet1.xml`, por entrada— antes de
 * leer una fila. Se sube en la misma proporción (≈5,3x el tamaño declarado),
 * no se desactiva: el tope es lo que frena una zip bomb. */
const RISK_IMPORT_LIMITS = {
  maxUncompressedBytes: 107 * 1024 * 1024,
  maxSingleEntryBytes:   27 * 1024 * 1024,
}
const STORAGE_PREFIX = "storage/risk-imports/"

const COLUMN_ALIASES: Record<string, string[]> = {
  processCode: ["codigo proceso", "código proceso"],
  processName: ["proceso"],
  taskCode: ["codigo tarea", "código tarea"],
  taskName: ["tarea", "actividad"],
  positionCode: ["codigo puesto", "código puesto", "codigo cargo"],
  positionName: ["puesto", "puesto de trabajo", "cargo"],
  hazardCode: ["codigo peligro", "código peligro", "id peligro"],
  hazard: ["peligro"],
  riskFactor: ["factor", "factor de riesgo"],
  expectedEventOrDamage: ["evento o dano", "evento o daño", "dano esperado", "daño esperado", "consecuencia"],
  exposedPeopleDescription: ["personas expuestas", "expuestos"],
  exposedPeopleCount: ["cantidad expuestos", "n expuestos", "n° expuestos"],
  genderConsiderations: ["enfoque de genero", "enfoque de género", "genero", "género"],
  sensitiveWorkerConsiderations: ["sensibilidad", "personas especialmente sensibles"],
  inherentDimensions: ["dimensiones inherentes", "evaluacion inherente", "evaluación inherente"],
  inherentScore: ["puntaje inherente", "valor inherente"],
  inherentLevel: ["nivel inherente", "riesgo inherente"],
  residualDimensions: ["dimensiones residuales", "evaluacion residual", "evaluación residual"],
  residualScore: ["puntaje residual", "valor residual"],
  residualLevel: ["nivel residual", "riesgo residual"],
  isCritical: ["riesgo critico", "riesgo crítico", "critico", "crítico"],
  responsibleSnapshot: ["responsable"],
  evidenceReference: ["evidencia", "referencia evidencia"],
  controls: ["controles", "medidas de control"],
}

interface NormalizedRiskImportRow {
  process: { code: string; name: string }
  task: { code: string; name: string; isRoutine: boolean }
  position: { code: string; name: string }
  hazardCode: string
  hazard: string
  riskFactor: string
  expectedEventOrDamage: string
  exposedPeopleDescription: string
  exposedPeopleCount: number | null
  genderConsiderations: string
  sensitiveWorkerConsiderations: string
  inherentDimensions: Record<string, unknown>
  inherentScore: number | null
  inherentLevel: string
  residualDimensions: Record<string, unknown>
  residualScore: number | null
  residualLevel: string
  isCritical: boolean
  responsibleSnapshot: string
  evidenceReference: string | null
  controls: Array<{
    description: string
    hierarchy: "elimination" | "substitution" | "engineering" | "administrative" | "ppe"
    isExisting: boolean
    isCritical: boolean
    performanceStandard: string | null
    verificationFrequency: string | null
    responsibleSnapshot: string
    status: "proposed"
  }>
}

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ")
}

function text(value: ExcelJS.CellValue | undefined) {
  if (value == null) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== "object") return String(value).trim()
  if ("result" in value && value.result != null) return text(value.result as ExcelJS.CellValue)
  if ("text" in value && typeof value.text === "string") return value.text.trim()
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((item) => item.text).join("").trim()
  return ""
}

function slug(value: string, fallback: string) {
  const normalized = normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return normalized || fallback
}

function numberOrNull(value: string) {
  const parsed = Number(value.replace(/\./g, "").replace(",", "."))
  return value.trim() && Number.isFinite(parsed) ? parsed : null
}

function booleanValue(value: string) {
  return ["1", "si", "sí", "true", "x", "critico", "crítico"].includes(normalize(value))
}

function dimensions(value: string) {
  if (!value.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Los formatos históricos suelen usar "probabilidad: 3; consecuencia: 4".
  }
  return Object.fromEntries(value.split(/[;|]/).map((item) => item.split(":").map((part) => part.trim())).filter((parts) => parts.length === 2 && parts[0]))
}

function controlHierarchy(value: string): NormalizedRiskImportRow["controls"][number]["hierarchy"] {
  const normalized = normalize(value)
  if (/elimin/.test(normalized)) return "elimination"
  if (/sustit/.test(normalized)) return "substitution"
  if (/ingenier|aislam|barrera/.test(normalized)) return "engineering"
  if (/epp|proteccion personal/.test(normalized)) return "ppe"
  return "administrative"
}

function parseControls(value: string, responsible: string, critical: boolean) {
  return value.split(/[;\n]/).map((item) => item.trim()).filter(Boolean).map((item, index) => {
    const [prefix, ...descriptionParts] = item.split(":")
    const hasPrefix = descriptionParts.length > 0
    const description = hasPrefix ? descriptionParts.join(":").trim() : item
    const isCritical = critical && index === 0
    return {
      description,
      hierarchy: controlHierarchy(hasPrefix ? prefix! : item),
      isExisting: true,
      isCritical,
      performanceStandard: isCritical ? "Verificación documentada de disponibilidad y desempeño" : null,
      verificationFrequency: isCritical ? "Mensual" : null,
      responsibleSnapshot: responsible,
      status: "proposed" as const,
    }
  })
}

function buildColumnMap(row: ExcelJS.Row) {
  const map = new Map<string, number>()
  row.eachCell({ includeEmpty: false }, (cell, column) => {
    const header = normalize(text(cell.value))
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (!map.has(field) && aliases.some((alias) => normalize(alias) === header)) map.set(field, column)
    }
  })
  const required = ["processName", "taskName", "positionName", "hazard", "riskFactor", "expectedEventOrDamage", "inherentLevel", "residualLevel", "responsibleSnapshot"]
  const missing = required.filter((field) => !map.has(field))
  if (missing.length) throw new Error(`El Excel MIPER no contiene columnas obligatorias reconocibles: ${missing.join(", ")}.`)
  return map
}

function readOriginal(row: ExcelJS.Row, columns: Map<string, number>) {
  return Object.fromEntries([...columns].map(([field, column]) => [field, text(row.getCell(column).value)]))
}

function normalizeRow(original: Record<string, string>, rowNumber: number): NormalizedRiskImportRow {
  const processName = original.processName?.trim() ?? ""
  const taskName = original.taskName?.trim() ?? ""
  const positionName = original.positionName?.trim() ?? ""
  const hazard = original.hazard?.trim() ?? ""
  const responsibleSnapshot = original.responsibleSnapshot?.trim() ?? ""
  const critical = booleanValue(original.isCritical ?? "")
  return {
    process: { code: original.processCode?.trim() || slug(processName, `proceso-${rowNumber}`), name: processName },
    task: { code: original.taskCode?.trim() || slug(taskName, `tarea-${rowNumber}`), name: taskName, isRoutine: true },
    position: { code: original.positionCode?.trim() || slug(positionName, `puesto-${rowNumber}`), name: positionName },
    hazardCode: original.hazardCode?.trim() || `R${rowNumber}`,
    hazard,
    riskFactor: original.riskFactor?.trim() ?? "",
    expectedEventOrDamage: original.expectedEventOrDamage?.trim() ?? "",
    exposedPeopleDescription: original.exposedPeopleDescription?.trim() || "Personas que ejecutan la tarea",
    exposedPeopleCount: numberOrNull(original.exposedPeopleCount ?? ""),
    genderConsiderations: original.genderConsiderations?.trim() || "Requiere validación participativa del enfoque de género",
    sensitiveWorkerConsiderations: original.sensitiveWorkerConsiderations?.trim() || "Requiere validar personas especialmente sensibles",
    inherentDimensions: dimensions(original.inherentDimensions ?? ""),
    inherentScore: numberOrNull(original.inherentScore ?? ""),
    inherentLevel: original.inherentLevel?.trim() ?? "",
    residualDimensions: dimensions(original.residualDimensions ?? ""),
    residualScore: numberOrNull(original.residualScore ?? ""),
    residualLevel: original.residualLevel?.trim() ?? "",
    isCritical: critical,
    responsibleSnapshot,
    evidenceReference: original.evidenceReference?.trim() || null,
    controls: parseControls(original.controls ?? "", responsibleSnapshot, critical),
  }
}

/* El contrato real de una fila es `riskEntrySchema` — es lo que corre
 * `addRiskEntryWithClient` al activar el lote. Comprobar sólo la lista de
 * mínimos de abajo dejaba filas marcadas `ready` que después no parseaban
 * (nivel de riesgo fuera del vocabulario, jerarquía de control desconocida,
 * campos que superan el máximo…), y como la activación corre en una sola
 * transacción, UNA de esas filas abortaba el lote entero: aprobado, no
 * activable y —porque `resolveRiskImportRow` exige `staged`— tampoco
 * corregible. MIPER-04. */
const riskEntryContract = riskEntrySchema.omit({ matrixId: true, sourceRowNumber: true, sourceOriginal: true, sourceNormalized: true, normalizationDecision: true })

function contractIssues(row: NormalizedRiskImportRow) {
  const parsed = riskEntryContract.safeParse(row)
  if (parsed.success) return []
  return parsed.error.issues.map((issue) => `${issue.path.join(".") || "fila"}: ${issue.message}`)
}

function issuesFor(row: NormalizedRiskImportRow) {
  const issues: string[] = []
  if (!row.process.name) issues.push("Proceso vacío")
  if (!row.task.name) issues.push("Tarea vacía")
  if (!row.position.name) issues.push("Puesto vacío")
  if (row.hazard.length < 3) issues.push("Peligro insuficiente")
  if (row.riskFactor.length < 2) issues.push("Factor insuficiente")
  if (row.expectedEventOrDamage.length < 3) issues.push("Evento o daño insuficiente")
  if (!row.inherentLevel) issues.push("Nivel inherente vacío")
  if (!row.residualLevel) issues.push("Nivel residual vacío")
  if (row.responsibleSnapshot.length < 2) issues.push("Responsable vacío")
  if (row.isCritical && row.controls.length === 0) issues.push("Riesgo crítico sin control")
  return issues.length ? issues : contractIssues(row)
}

/* La identidad de una entrada MIPER es la tupla del índice único
 * `prevention_risk_entries_matrix_identity_unique`: proceso, tarea, puesto y
 * código de peligro. El texto del peligro NO entra — incluirlo hacía que dos
 * filas con el mismo código y distinta redacción pasaran el filtro de
 * duplicados del archivo y después chocaran contra el índice al activar,
 * matando el lote completo. */
function fingerprint(row: NormalizedRiskImportRow) {
  return createHash("sha256").update(JSON.stringify({ process: row.process.code, task: row.task.code, position: row.position.code, hazardCode: row.hazardCode })).digest("hex")
}

function assertPermission(access: RiskLegalAccess, permission: string, worksiteId?: string) {
  const scopeAllows = !worksiteId || access.scope.mode === "all" || (access.scope.mode === "some" && access.scope.ids.includes(worksiteId))
  if (!access.permissions.includes(permission) || !scopeAllows) throw new Error("Lote MIPER no encontrado o fuera de alcance.")
}

export async function stageRiskImport(args: {
  worksiteId: string
  fileName: string
  buffer: Buffer
  mimeType?: string
  access: RiskLegalAccess
}) {
  assertPermission(args.access, "prevention:risk:edit", args.worksiteId)
  // Envolvente ZIP antes de que el buffer toque ExcelJS: firma, expansión,
  // cifrado y rutas internas (mismo orden que la importación PDTP).
  validateXlsxEnvelope({
    name: args.fileName,
    type: args.mimeType ?? "",
    size: args.buffer.length,
    buffer: args.buffer,
  }, RISK_IMPORT_MAX_BYTES, RISK_IMPORT_LIMITS)
  const checksum = createHash("sha256").update(args.buffer).digest("hex")
  const [existing] = await db.select().from(preventionRiskImportBatches).where(and(eq(preventionRiskImportBatches.worksiteId, args.worksiteId), eq(preventionRiskImportBatches.sourceChecksumSha256, checksum))).limit(1)
  if (existing) return { batch: existing, idempotentReplay: true }
  const [worksite] = await db.select({ id: worksites.id }).from(worksites).where(and(eq(worksites.id, args.worksiteId), eq(worksites.isActive, true))).limit(1)
  if (!worksite) throw new Error("Faena no encontrada o fuera de alcance.")

  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(args.buffer as never, { ignoreNodes: ["dataValidations", "conditionalFormatting", "hyperlinks"] }) }
  catch { throw new Error("El archivo no es un Excel válido.") }
  validateLoadedWorkbook(workbook, MAX_ROWS, RISK_IMPORT_LIMITS)
  const sheet = workbook.worksheets[0]!
  const columns = buildColumnMap(sheet.getRow(1))
  const rows: Array<{ rowNumber: number; original: Record<string, string>; normalized: NormalizedRiskImportRow; issues: string[]; fingerprint: string }> = []
  const seen = new Set<string>()
  /* `resolveHierarchy` reutiliza proceso/tarea/puesto por código y revienta si
   * el mismo código llega con otro nombre. Detectarlo acá convierte lo que era
   * un lote muerto en una fila observada que se corrige antes de aprobar.
   *
   * ponytail: sólo mira el archivo. El choque contra un código ya existente en
   * la faena (de otro lote o de una MIPER previa) sigue apareciendo al activar,
   * pero ahora con `Fila N` y con `reopenRiskImportBatch` para arreglarlo. Si se
   * vuelve frecuente, la consulta que lo adelantaría es una sola contra
   * `prevention_risk_processes` de la faena. */
  const namesByCode = new Map<string, string>()
  function nameConflicts(kind: string, code: string, name: string) {
    const previous = namesByCode.get(code)
    if (previous === undefined) { namesByCode.set(code, name); return null }
    return previous === name ? null : `El código de ${kind} "${code}" ya aparece en el archivo con otro nombre ("${previous}")`
  }
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const original = readOriginal(row, columns)
    if (!Object.values(original).some(Boolean)) return
    const normalized = normalizeRow(original, rowNumber)
    const rowIssues = issuesFor(normalized)
    const processKey = `proceso:${normalized.process.code}`
    const taskKey = `tarea:${normalized.process.code}|${normalized.task.code}`
    const positionKey = `puesto:${taskKey}|${normalized.position.code}`
    for (const conflict of [
      nameConflicts("proceso", processKey, normalized.process.name),
      nameConflicts("tarea", taskKey, normalized.task.name),
      nameConflicts("puesto", positionKey, normalized.position.name),
    ]) if (conflict) rowIssues.push(conflict)
    const rowFingerprint = fingerprint(normalized)
    if (seen.has(rowFingerprint)) rowIssues.push("Duplicado dentro del archivo")
    seen.add(rowFingerprint)
    rows.push({ rowNumber, original, normalized, issues: rowIssues, fingerprint: rowFingerprint })
  })
  if (!rows.length) throw new Error("El Excel no contiene filas MIPER utilizables.")

  const batchId = `riskimport-${nanoid()}`
  const storageName = `${batchId}.xlsx`
  const relativePath = `${STORAGE_PREFIX}${storageName}`
  const directory = resolveRiskImportsDir()
  const absolutePath = resolveStorageFile(directory, storageName)
  await mkdirp(directory)
  await writeBuffer(absolutePath, args.buffer)
  try {
    const batch = await db.transaction(async (tx) => {
      const readyRows = rows.filter((row) => row.issues.length === 0).length
      const reviewRows = rows.length - readyRows
      const [created] = await tx.insert(preventionRiskImportBatches).values({
        id: batchId,
        worksiteId: args.worksiteId,
        sourceFileName: args.fileName,
        sourceFilePath: relativePath,
        sourceChecksumSha256: checksum,
        sourceSizeBytes: args.buffer.length,
        sourceSheetName: sheet.name,
        totalRows: rows.length,
        readyRows,
        reviewRows,
        createdByUserId: args.access.userId,
      }).returning()
      for (const row of rows) {
        const duplicate = row.issues.includes("Duplicado dentro del archivo")
        await tx.insert(preventionRiskImportRows).values({
          id: `riskimportrow-${nanoid()}`,
          batchId,
          rowNumber: row.rowNumber,
          original: row.original,
          normalized: row.normalized,
          fingerprintSha256: row.fingerprint,
          status: duplicate ? "duplicate" : row.issues.length ? "needs_review" : "ready",
          issues: row.issues,
        })
      }
      return created!
    })
    return { batch, idempotentReplay: false }
  } catch (error) {
    await removeFile(absolutePath).catch(() => undefined)
    throw error
  }
}

export async function resolveRiskImportRow(input: unknown, access: RiskLegalAccess) {
  const data = z.object({
    rowId: z.string().min(1),
    normalized: z.record(z.string(), z.unknown()),
    resolution: z.string().trim().min(10).max(3000),
    reject: z.boolean().default(false),
  }).parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ row: preventionRiskImportRows, batch: preventionRiskImportBatches }).from(preventionRiskImportRows).innerJoin(preventionRiskImportBatches, eq(preventionRiskImportBatches.id, preventionRiskImportRows.batchId)).where(eq(preventionRiskImportRows.id, data.rowId)).limit(1)
    if (!row) throw new Error("Fila MIPER no encontrada o fuera de alcance.")
    assertPermission(access, "prevention:risk:edit", row.batch.worksiteId)
    if (row.batch.status !== "staged") throw new Error("Sólo un lote en revisión admite correcciones.")
    let normalized: NormalizedRiskImportRow | Record<string, unknown> = data.normalized
    let issues: string[] = []
    if (!data.reject) {
      const parsed = riskEntryContract.safeParse(data.normalized)
      if (!parsed.success) throw new Error(`La normalización corregida no cumple el contrato MIPER: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "fila"}: ${issue.message}`).join("; ")}.`)
      normalized = parsed.data as unknown as NormalizedRiskImportRow
      issues = issuesFor(normalized as NormalizedRiskImportRow)
      if (issues.length) throw new Error(`La fila aún tiene observaciones: ${issues.join("; ")}.`)
    }
    const status = data.reject ? "rejected" : "ready"
    const now = new Date().toISOString()
    const [updated] = await tx.update(preventionRiskImportRows).set({ normalized, status, issues, resolution: data.resolution, resolvedByUserId: access.userId, resolvedAt: now }).where(eq(preventionRiskImportRows.id, row.row.id)).returning()
    const counts = await tx.select({
      ready: sql<number>`count(*) filter (where ${preventionRiskImportRows.status} = 'ready')::int`,
      review: sql<number>`count(*) filter (where ${preventionRiskImportRows.status} = 'needs_review')::int`,
    }).from(preventionRiskImportRows).where(eq(preventionRiskImportRows.batchId, row.batch.id))
    await tx.update(preventionRiskImportBatches).set({ readyRows: counts[0]?.ready ?? 0, reviewRows: counts[0]?.review ?? 0 }).where(eq(preventionRiskImportBatches.id, row.batch.id))
    return updated!
  })
}

export async function approveRiskImportBatch(batchId: string, access: RiskLegalAccess) {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(preventionRiskImportBatches).where(eq(preventionRiskImportBatches.id, batchId)).limit(1)
    if (!batch) throw new Error("Lote MIPER no encontrado o fuera de alcance.")
    assertPermission(access, "prevention:risk:approve", batch.worksiteId)
    if (batch.createdByUserId === access.userId) throw new Error("Quien importó el archivo no puede aprobar el lote.")
    if (batch.status !== "staged") throw new Error("El lote no está pendiente de aprobación.")
    const counts = await tx.select({ blocking: sql<number>`count(*) filter (where ${preventionRiskImportRows.status} = 'needs_review')::int` }).from(preventionRiskImportRows).where(eq(preventionRiskImportRows.batchId, batch.id))
    if (counts[0]?.blocking) throw new Error("Debes resolver todas las filas observadas antes de aprobar.")
    const now = new Date().toISOString()
    const [updated] = await tx.update(preventionRiskImportBatches).set({ status: "approved", approvedByUserId: access.userId, approvedAt: now }).where(and(eq(preventionRiskImportBatches.id, batch.id), eq(preventionRiskImportBatches.status, "staged"))).returning()
    // MIPER-11: el predicado `status = 'staged'` es el CAS que evita la doble
    // aprobación, pero `updated!` mentía sobre su resultado. Con dos
    // aprobaciones simultáneas la segunda no actualizaba ninguna fila y aun así
    // devolvía "aprobado" —con `undefined` disfrazado de lote por el `!`—, así
    // que la pantalla mostraba éxito y el aprobador quedaba registrado como
    // otro. Mismo `if (!updated) throw` que `reopenRiskImportBatch` y el resto
    // del módulo.
    if (!updated) throw new Error("El lote cambió mientras lo aprobabas. Recarga antes de continuar.")
    return updated
  })
}

/**
 * Devuelve un lote aprobado a revisión para poder corregirlo o rechazar sus
 * filas (MIPER-04).
 *
 * Sin esto un lote aprobado que no activa no tenía salida desde la aplicación:
 * `resolveRiskImportRow` sólo admite lotes `staged` y `stageRiskImport` devuelve
 * el mismo lote si vuelves a subir el archivo (índice único por checksum). Pide
 * `prevention:risk:edit` y no `:approve` porque reabrir sólo QUITA una
 * aprobación: para volver a avanzar hace falta que otra persona apruebe otra
 * vez, así que quien corrige puede desatascarse solo sin saltarse a nadie.
 */
export async function reopenRiskImportBatch(input: unknown, access: RiskLegalAccess) {
  const data = z.object({ batchId: z.string().min(1), reason: z.string().trim().min(10).max(3000) }).parse(input)
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(preventionRiskImportBatches).where(eq(preventionRiskImportBatches.id, data.batchId)).limit(1)
    if (!batch) throw new Error("Lote MIPER no encontrado o fuera de alcance.")
    assertPermission(access, "prevention:risk:edit", batch.worksiteId)
    if (batch.status !== "approved") throw new Error("Sólo un lote aprobado y aún sin activar puede reabrirse.")
    const [matrix] = await tx.select({ id: preventionRiskMatrices.id, status: preventionRiskMatrices.status }).from(preventionRiskMatrices).where(eq(preventionRiskMatrices.sourceImportBatchId, batch.id)).limit(1)
    // Si ya nació la versión borrador desde este lote, reabrirlo dejaría dos
    // orígenes de verdad para el mismo peligro. Se corrige en la MIPER.
    if (matrix) throw new Error("El lote ya generó una versión MIPER: corrige el peligro en la versión borrador.")
    const [updated] = await tx.update(preventionRiskImportBatches)
      .set({ status: "staged", approvedByUserId: null, approvedAt: null })
      .where(and(eq(preventionRiskImportBatches.id, batch.id), eq(preventionRiskImportBatches.status, "approved")))
      .returning()
    if (!updated) throw new Error("El lote cambió mientras lo reabrías. Recarga antes de continuar.")
    await recordModuleHistory(tx, {
      module: "risk_legal:import",
      entityType: "import_batch",
      entityId: batch.id,
      worksiteId: batch.worksiteId,
      changeType: "reopened",
      reason: data.reason,
      beforeState: { status: batch.status, approvedByUserId: batch.approvedByUserId },
      afterState: { status: updated.status },
      actorUserId: access.userId,
    })
    return updated
  })
}

export async function activateRiskImportBatch(input: unknown, access: RiskLegalAccess) {
  const data = z.object({
    batchId: z.string().min(1),
    title: z.string().trim().min(5).max(500),
    methodologyId: z.string().min(1),
    revisionReason: z.string().trim().min(10).max(3000),
    participationSummary: z.string().trim().min(10).max(5000),
    consultationEvidenceReference: z.string().trim().min(3).max(2000),
    // Una MIPER nacida de un Excel acredita la participación del comité igual que
    // una creada a mano: sin esto, las importadas no podían alimentar el crédito
    // Oro `iper_committee_participation` y ese camino quedaba a medias.
    // `createRiskMatrixDraftWithClient` valida faena y estado de la sesión.
    committeeMeetingId: z.string().min(1).nullable().optional(),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(preventionRiskImportBatches).where(eq(preventionRiskImportBatches.id, data.batchId)).limit(1)
    if (!batch) throw new Error("Lote MIPER no encontrado o fuera de alcance.")
    assertPermission(access, "prevention:risk:edit", batch.worksiteId)
    if (!inArrayStatus(batch.status, ["approved", "activated"])) throw new Error("El lote debe estar aprobado antes de activarlo.")

    let [matrix] = await tx.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.sourceImportBatchId, batch.id)).limit(1)
    if (!matrix) {
      matrix = await createRiskMatrixDraftWithClient(tx, {
        worksiteId: batch.worksiteId,
        title: data.title,
        methodologyId: data.methodologyId,
        revisionReason: data.revisionReason,
        participationSummary: data.participationSummary,
        consultationEvidenceReference: data.consultationEvidenceReference,
        committeeMeetingId: data.committeeMeetingId ?? null,
        sourceImportBatchId: batch.id,
      }, access)
    }
    if (matrix.status !== "draft") return { matrix, completed: batch.status === "activated", remaining: 0 }

    const rows = await tx.select().from(preventionRiskImportRows).where(and(eq(preventionRiskImportRows.batchId, batch.id), eq(preventionRiskImportRows.status, "ready"))).orderBy(asc(preventionRiskImportRows.rowNumber))
    for (const row of rows) {
      const normalized = row.normalized as NormalizedRiskImportRow
      /* La activación es una sola transacción: si una fila revienta se pierde
       * el lote entero, así que el error tiene que decir CUÁL fila. Antes
       * llegaba como un ZodError anónimo y no había forma de saber dónde
       * mirar — ni de reabrir el lote para arreglarla (`reopenRiskImportBatch`). */
      try {
        const { entry } = await addRiskEntryWithClient(tx, {
          matrixId: matrix.id,
          ...normalized,
          sourceRowNumber: row.rowNumber,
          sourceOriginal: row.original,
          sourceNormalized: row.normalized as Record<string, unknown>,
          normalizationDecision: row.resolution ?? "Normalización automática pendiente de aprobación de la versión MIPER",
        }, access)
        await tx.update(preventionRiskImportRows).set({ status: "activated", riskEntryId: entry.id }).where(eq(preventionRiskImportRows.id, row.id))
      } catch (error) {
        const detail = error instanceof ZodError
          ? error.issues.map((issue) => `${issue.path.join(".") || "fila"}: ${issue.message}`).join("; ")
          : error instanceof Error ? error.message : String(error)
        throw new Error(`Fila ${row.rowNumber}: ${detail} Reabre el lote para corregirla o rechazarla.`)
      }
    }

    const counts = await tx.select({ remaining: sql<number>`count(*) filter (where ${preventionRiskImportRows.status} IN ('ready', 'needs_review'))::int` }).from(preventionRiskImportRows).where(eq(preventionRiskImportRows.batchId, batch.id))
    const remaining = counts[0]?.remaining ?? 0
    const completed = remaining === 0
    if (completed) await tx.update(preventionRiskImportBatches).set({ status: "activated", activatedMatrixId: matrix.id, activatedByUserId: access.userId, activatedAt: new Date().toISOString() }).where(eq(preventionRiskImportBatches.id, batch.id))
    return { matrix, completed, remaining }
  })
}

function inArrayStatus<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.includes(value as T)
}

export async function listRiskImportBatches(access: RiskLegalAccess, opts?: { limit?: number; offset?: number }) {
  assertPermission(access, "prevention:risk:view")
  if (access.scope.mode === "none") return []
  const limit = Math.min(opts?.limit ?? 500, 500)
  const offset = opts?.offset ?? 0
  const batches = await db.select().from(preventionRiskImportBatches).where(access.scope.mode === "all" ? undefined : inArray(preventionRiskImportBatches.worksiteId, access.scope.ids)).orderBy(asc(preventionRiskImportBatches.createdAt)).limit(limit).offset(offset)
  const rows = batches.length ? await db.select().from(preventionRiskImportRows).where(inArray(preventionRiskImportRows.batchId, batches.map((item) => item.id))).orderBy(asc(preventionRiskImportRows.rowNumber)) : []
  const rowsByBatch = new Map<string, typeof rows>()
  for (const row of rows) rowsByBatch.set(row.batchId, [...(rowsByBatch.get(row.batchId) ?? []), row])
  return batches.map((batch) => ({ ...batch, rows: rowsByBatch.get(batch.id) ?? [] }))
}

export async function listRiskImportBatchesPage(access: RiskLegalAccess, opts?: { limit?: number; offset?: number }) {
  assertPermission(access, "prevention:risk:view")
  if (access.scope.mode === "none") return { rows: [], total: 0, limit: opts?.limit ?? 50, offset: opts?.offset ?? 0 }
  const limit = Math.min(opts?.limit ?? 50, 500)
  const offset = opts?.offset ?? 0
  const where = access.scope.mode === "all" ? undefined : inArray(preventionRiskImportBatches.worksiteId, access.scope.ids)
  const [batches, [totalRow]] = await Promise.all([
    db.select().from(preventionRiskImportBatches).where(where).orderBy(asc(preventionRiskImportBatches.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(preventionRiskImportBatches).where(where),
  ])
  const rows = batches.length ? await db.select().from(preventionRiskImportRows).where(inArray(preventionRiskImportRows.batchId, batches.map((item) => item.id))).orderBy(asc(preventionRiskImportRows.rowNumber)) : []
  const rowsByBatch = new Map<string, typeof rows>()
  for (const row of rows) rowsByBatch.set(row.batchId, [...(rowsByBatch.get(row.batchId) ?? []), row])
  return {
    rows: batches.map((batch) => ({ ...batch, rows: rowsByBatch.get(batch.id) ?? [] })),
    total: totalRow?.count ?? 0,
    limit,
    offset,
  }
}

export function resolveRiskImportSourcePath(filePath: string) {
  if (!filePath.startsWith(STORAGE_PREFIX)) return null
  const fileName = filePath.slice(STORAGE_PREFIX.length)
  if (!/^[a-zA-Z0-9_-]+\.xlsx$/.test(fileName)) return null
  return resolveStorageFile(resolveRiskImportsDir(), fileName)
}

export async function getRiskImportSourceFile(batchId: string, access: RiskLegalAccess) {
  const [batch] = await db.select().from(preventionRiskImportBatches).where(eq(preventionRiskImportBatches.id, batchId)).limit(1)
  if (!batch) throw new Error("Lote MIPER no encontrado o fuera de alcance.")
  assertPermission(access, "prevention:risk:view", batch.worksiteId)
  const absolutePath = resolveRiskImportSourcePath(batch.sourceFilePath)
  if (!absolutePath) throw new Error("Ruta de original MIPER inválida.")
  return { batch, absolutePath }
}

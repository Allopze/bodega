import { createHash } from "node:crypto"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { z } from "zod"
import { db, type DB, type Tx } from "@/db"
import {
  preventionTrainingCatalogItems,
  preventionTrainingOccurrenceEvidence,
  preventionTrainingOccurrences,
  preventionTrainingHistory,
  users,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { generateStorageName } from "@/lib/services/prevention-documents/utils"
import {
  PREDEFINED_TRAINING_CATALOG,
  PREDEFINED_TRAINING_CATALOG_VERSION,
  PREDEFINED_TRAINING_CATALOG_YEAR,
  assertPredefinedTrainingCatalogYear,
  isPredefinedTrainingCatalogYear,
  occurrenceSeedRows,
  trainingCatalogItemId,
} from "@/lib/prevention/training-occurrences-catalog"
import { mkdirp, removeFile, writeBuffer } from "@/lib/storage/helpers"
import {
  createPreventionTrainingEvidencePath,
  resolvePreventionTrainingEvidenceDir,
  resolveStorageFile,
} from "@/lib/storage/config"
import {
  recordPendingPdtpFulfillmentEvent,
  recordPendingPdtpFulfillmentRevocation,
  recordPdtpFulfillmentEvent,
  recordPdtpFulfillmentRevocation,
} from "@/lib/services/pdtp/fulfillment"
import type { AccreditationInput, RevocationInput } from "@/lib/services/pdtp/accreditation"
import { nanoid } from "@/lib/id"

export const TRAINING_OCCURRENCE_MAX_FILE_SIZE = 25 * 1024 * 1024
// El margen cubre los campos multipart y los encabezados sin permitir que una
// petición con varios archivos grandes llegue a `formData()` antes de ser
// rechazada.
export const TRAINING_OCCURRENCE_MAX_REQUEST_SIZE = TRAINING_OCCURRENCE_MAX_FILE_SIZE + 256 * 1024
export const TRAINING_OCCURRENCE_ENTITY_TYPE = "training_occurrence"

type Client = DB | Tx

export type TrainingOccurrenceStatus = "pending" | "completed" | "not_completed"

export interface TrainingOccurrenceAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

export interface TrainingOccurrenceEvidenceListItem {
  id: string
  fileName: string
  storagePath: string
  mimeType: string
  fileSizeBytes: number
  sha256: string
  state: string
  uploadedByUserId: string | null
  uploadedAt: string
  annulledAt: string | null
  annulledReason: string | null
}

export interface TrainingOccurrenceListItem {
  id: string
  version: number
  code: string
  title: string
  itemType: string
  audience: string
  catalogVersion: string
  pdtpActivityNumbers: number[]
  worksiteId: string
  worksiteName: string
  worksiteActive: boolean
  year: number
  slotKey: string
  scheduledMonth: number | null
  scheduledWeek: number | null
  status: TrainingOccurrenceStatus
  completedAt: string | null
  completedByUserId: string | null
  completedByName: string | null
  observation: string | null
  evidence: TrainingOccurrenceEvidenceListItem[]
}

const statusSchema = z.enum(["completed", "not_completed"])

const statusInputSchema = z.object({
  occurrenceId: z.string().trim().min(1).max(200),
  expectedVersion: z.number().int().positive(),
  status: statusSchema,
  observation: z.string().trim().max(3000).nullable().optional(),
})

function scopeAllows(scope: WorksiteScope, worksiteId: string): boolean {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function scopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

function requireAccess(access: TrainingOccurrenceAccess, permission: string, worksiteId?: string): void {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error("Registro de capacitación no encontrado o fuera de alcance.")
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function catalogInsertRows() {
  return PREDEFINED_TRAINING_CATALOG.map(catalogItemToInsert)
}

/** Inserta el catálogo controlado sin tocar estados ni evidencias existentes. */
export async function ensurePreventionTrainingCatalogTx(client: Client): Promise<void> {
  await client.insert(preventionTrainingCatalogItems)
    .values(catalogInsertRows())
    .onConflictDoNothing({ target: [
      preventionTrainingCatalogItems.catalogVersion,
      preventionTrainingCatalogItems.code,
    ] })
}

/**
 * Crea las posiciones del cronograma para una faena. Es idempotente y se usa
 * tanto en el seed como al activar una faena nueva; nunca sobreescribe una
 * ocurrencia que ya tenga estado, observación o evidencia.
 */
export async function ensurePreventionTrainingOccurrencesForWorksiteTx(
  client: Client,
  worksiteId: string,
  year = PREDEFINED_TRAINING_CATALOG_YEAR,
): Promise<number> {
  assertPredefinedTrainingCatalogYear(year)
  await ensurePreventionTrainingCatalogTx(client)
  const catalogRows = await client.select({
    id: preventionTrainingCatalogItems.id,
    code: preventionTrainingCatalogItems.code,
  })
    .from(preventionTrainingCatalogItems)
    .where(and(
      eq(preventionTrainingCatalogItems.catalogVersion, PREDEFINED_TRAINING_CATALOG_VERSION),
      eq(preventionTrainingCatalogItems.isActive, true),
    ))

  const itemByCode = new Map(catalogRows.map((row) => [row.code, row.id]))
  const values = PREDEFINED_TRAINING_CATALOG.flatMap((item) => occurrenceSeedRows(item, worksiteId, year)
    .map((row) => {
      const catalogItemId = itemByCode.get(row.catalogCode)
      if (!catalogItemId) {
        throw new Error(`El catálogo de capacitación no contiene el ítem ${row.catalogCode}.`)
      }
      return {
        id: row.id,
        catalogItemId,
        worksiteId: row.worksiteId,
        year: row.year,
        slotKey: row.slotKey,
        scheduledMonth: row.scheduledMonth,
        scheduledWeek: row.scheduledWeek,
        status: row.status,
        version: row.version,
      }
    }))

  if (values.length === 0) return 0
  const inserted = await client.insert(preventionTrainingOccurrences)
    .values(values)
    .onConflictDoNothing({ target: [
      preventionTrainingOccurrences.catalogItemId,
      preventionTrainingOccurrences.worksiteId,
      preventionTrainingOccurrences.year,
      preventionTrainingOccurrences.slotKey,
    ] })
    .returning({ id: preventionTrainingOccurrences.id })
  return inserted.length
}

export async function ensurePreventionTrainingOccurrencesForActiveWorksites(
  client: Client,
  year = PREDEFINED_TRAINING_CATALOG_YEAR,
): Promise<number> {
  assertPredefinedTrainingCatalogYear(year)
  const activeWorksites = await client.select({ id: worksites.id })
    .from(worksites)
    .where(eq(worksites.isActive, true))
  let created = 0
  for (const worksite of activeWorksites) {
    created += await ensurePreventionTrainingOccurrencesForWorksiteTx(client, worksite.id, year)
  }
  return created
}

export async function listTrainingOccurrenceWorksites(access: TrainingOccurrenceAccess) {
  requireAccess(access, "prevention:training:view")
  if (access.scope.mode === "none") return []
  return db.select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive })
    .from(worksites)
    .where(and(
      scopeCondition(access.scope, worksites.id),
    ))
    .orderBy(asc(worksites.name))
}

export async function listTrainingOccurrences(
  access: TrainingOccurrenceAccess,
  filters: { year?: number; worksiteId?: string; includeInactiveWorksites?: boolean } = {},
): Promise<TrainingOccurrenceListItem[]> {
  requireAccess(access, "prevention:training:view")
  if (access.scope.mode === "none") return []

  const year = filters.year ?? PREDEFINED_TRAINING_CATALOG_YEAR
  if (!isPredefinedTrainingCatalogYear(year)) return []
  const rows = await db.select({
    occurrence: preventionTrainingOccurrences,
    catalog: preventionTrainingCatalogItems,
    worksiteName: worksites.name,
    worksiteActive: worksites.isActive,
    completedByName: users.name,
  })
    .from(preventionTrainingOccurrences)
    .innerJoin(preventionTrainingCatalogItems, eq(preventionTrainingOccurrences.catalogItemId, preventionTrainingCatalogItems.id))
    .innerJoin(worksites, eq(preventionTrainingOccurrences.worksiteId, worksites.id))
    .leftJoin(users, eq(preventionTrainingOccurrences.completedByUserId, users.id))
    .where(and(
      eq(preventionTrainingOccurrences.year, year),
      filters.includeInactiveWorksites ? undefined : eq(worksites.isActive, true),
      eq(preventionTrainingCatalogItems.catalogVersion, PREDEFINED_TRAINING_CATALOG_VERSION),
      eq(preventionTrainingCatalogItems.isActive, true),
      scopeCondition(access.scope, worksites.id),
      filters.worksiteId ? eq(worksites.id, filters.worksiteId) : undefined,
    ))
    .orderBy(
      asc(worksites.name),
      sql`${preventionTrainingOccurrences.scheduledMonth} NULLS LAST`,
      asc(preventionTrainingOccurrences.scheduledWeek),
      asc(preventionTrainingCatalogItems.sortOrder),
      asc(preventionTrainingOccurrences.slotKey),
    )

  if (rows.length === 0) return []
  const occurrenceIds = rows.map((row) => row.occurrence.id)
  const evidenceRows = await db.select().from(preventionTrainingOccurrenceEvidence)
    .where(inArray(preventionTrainingOccurrenceEvidence.occurrenceId, occurrenceIds))
    .orderBy(asc(preventionTrainingOccurrenceEvidence.uploadedAt))
  const evidenceByOccurrence = new Map<string, TrainingOccurrenceEvidenceListItem[]>()
  for (const evidence of evidenceRows) {
    const list = evidenceByOccurrence.get(evidence.occurrenceId) ?? []
    list.push({
      id: evidence.id,
      fileName: evidence.fileName,
      storagePath: evidence.storagePath,
      mimeType: evidence.mimeType,
      fileSizeBytes: evidence.fileSizeBytes,
      sha256: evidence.sha256,
      state: evidence.state,
      uploadedByUserId: evidence.uploadedByUserId,
      uploadedAt: evidence.uploadedAt,
      annulledAt: evidence.annulledAt,
      annulledReason: evidence.annulledReason,
    })
    evidenceByOccurrence.set(evidence.occurrenceId, list)
  }

  return rows.map(({ occurrence, catalog, worksiteName, worksiteActive, completedByName }) => ({
    id: occurrence.id,
    version: occurrence.version,
    code: catalog.code,
    title: catalog.title,
    itemType: catalog.itemType,
    audience: catalog.audience,
    catalogVersion: catalog.catalogVersion,
    pdtpActivityNumbers: (catalog.pdtpActivityNumbers as number[]) ?? [],
    worksiteId: occurrence.worksiteId,
    worksiteName,
    worksiteActive,
    year: occurrence.year,
    slotKey: occurrence.slotKey,
    scheduledMonth: occurrence.scheduledMonth,
    scheduledWeek: occurrence.scheduledWeek,
    status: occurrence.status as TrainingOccurrenceStatus,
    completedAt: occurrence.completedAt,
    completedByUserId: occurrence.completedByUserId,
    completedByName: completedByName ?? null,
    observation: occurrence.observation,
    evidence: evidenceByOccurrence.get(occurrence.id) ?? [],
  }))
}

async function loadOccurrenceForMutation(client: Client, occurrenceId: string) {
  const [row] = await client.select({
    occurrence: preventionTrainingOccurrences,
    catalog: preventionTrainingCatalogItems,
    worksiteName: worksites.name,
    worksiteActive: worksites.isActive,
  })
    .from(preventionTrainingOccurrences)
    .innerJoin(preventionTrainingCatalogItems, eq(preventionTrainingOccurrences.catalogItemId, preventionTrainingCatalogItems.id))
    .innerJoin(worksites, eq(preventionTrainingOccurrences.worksiteId, worksites.id))
    .where(eq(preventionTrainingOccurrences.id, occurrenceId))
    .for("update")
    .limit(1)
  return row
}

function occurrenceReturnHref(worksiteId: string, year: number): string {
  return `/prevencion/capacitacion?faena=${encodeURIComponent(worksiteId)}&year=${year}`
}

function pdtpCompletionInput(args: {
  occurrenceId: string
  worksiteId: string
  year: number
  scheduledMonth: number | null
  scheduledWeek: number | null
  activityNumbers: number[]
  evidenceRef: string | null
  catalogCode: string
  catalogTitle: string
  catalogVersion: string
  evidenceIds: string[]
  actorUserId: string
}): AccreditationInput & { sourceVersion: string; returnHref: string; plannedYear: number; plannedPeriod?: { year: number; month: number; week: number } } {
  return {
    sourceType: "capacitacion_ocurrencia",
    sourceId: args.occurrenceId,
    worksiteId: args.worksiteId,
    activityNumbers: args.activityNumbers,
    occurredAt: nowIso(),
    executedQuantity: 1,
    evidenceRef: args.evidenceRef ?? undefined,
    autoApproveByUserId: args.actorUserId,
    plannedYear: args.year,
    sourceVersion: args.catalogVersion,
    returnHref: occurrenceReturnHref(args.worksiteId, args.year),
    ...(args.scheduledMonth && args.scheduledWeek ? {
      plannedPeriod: {
        year: args.year,
        month: args.scheduledMonth,
        week: args.scheduledWeek,
      },
    } : {}),
    metadata: {
      catalogCode: args.catalogCode,
      catalogTitle: args.catalogTitle,
      catalogVersion: args.catalogVersion,
      occurrenceId: args.occurrenceId,
      evidenceIds: args.evidenceIds,
      plannedPeriod: args.scheduledMonth && args.scheduledWeek
        ? { year: args.year, month: args.scheduledMonth, week: args.scheduledWeek }
        : null,
      plannedYear: args.year,
    },
  }
}

function pdtpRevocationInput(occurrenceId: string, worksiteId: string, actorUserId: string, reason: string): RevocationInput {
  return {
    sourceType: "capacitacion_ocurrencia",
    sourceId: occurrenceId,
    worksiteId,
    revokedBy: actorUserId,
    reason,
  }
}

export async function recordTrainingOccurrenceStatus(
  rawInput: unknown,
  access: TrainingOccurrenceAccess,
): Promise<{ status: TrainingOccurrenceStatus; version: number }> {
  requireAccess(access, "prevention:training:record")
  const input = statusInputSchema.parse(rawInput)
  let completionEvent: (AccreditationInput & { sourceVersion: string; returnHref: string; plannedYear: number; plannedPeriod?: { year: number; month: number; week: number } }) | null = null
  let revocationEvent: RevocationInput | null = null

  const result = await db.transaction(async (tx) => {
    const current = await loadOccurrenceForMutation(tx, input.occurrenceId)
    if (!current || !current.worksiteActive || !current.catalog.isActive || !scopeAllows(access.scope, current.occurrence.worksiteId)) {
      throw new Error("Registro de capacitación no encontrado o fuera de alcance.")
    }
    if (current.occurrence.version !== input.expectedVersion) {
      throw new Error("La capacitación cambió mientras la editabas. Recarga y reintenta.")
    }
    const nextStatus = input.status
    if (current.occurrence.status === nextStatus) {
      throw new Error("La capacitación ya tiene ese estado.")
    }

    const activeEvidence = await tx.select().from(preventionTrainingOccurrenceEvidence)
      .where(and(
        eq(preventionTrainingOccurrenceEvidence.occurrenceId, input.occurrenceId),
        eq(preventionTrainingOccurrenceEvidence.state, "active"),
      ))
      .orderBy(asc(preventionTrainingOccurrenceEvidence.uploadedAt))

    if (nextStatus === "completed" && activeEvidence.length === 0) {
      throw new Error("Adjunta al menos una evidencia antes de marcar la capacitación como hecha.")
    }

    const now = nowIso()
    const observation = input.observation?.trim() || null
    const [updated] = await tx.update(preventionTrainingOccurrences).set({
      status: nextStatus,
      completedAt: nextStatus === "completed" ? now : null,
      completedByUserId: nextStatus === "completed" ? access.userId : null,
      observation,
      version: current.occurrence.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionTrainingOccurrences.id, input.occurrenceId),
      eq(preventionTrainingOccurrences.version, input.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La capacitación cambió mientras la editabas. Recarga y reintenta.")

    const annulledEvidenceIds: string[] = []
    if (nextStatus === "not_completed" && activeEvidence.length > 0) {
      const annulled = await tx.update(preventionTrainingOccurrenceEvidence).set({
        state: "annulled",
        annulledByUserId: access.userId,
        annulledAt: now,
        annulledReason: "La ocurrencia fue corregida a no hecha; la evidencia anterior se conserva como historial.",
      }).where(and(
        eq(preventionTrainingOccurrenceEvidence.occurrenceId, input.occurrenceId),
        eq(preventionTrainingOccurrenceEvidence.state, "active"),
      )).returning({ id: preventionTrainingOccurrenceEvidence.id })
      annulledEvidenceIds.push(...annulled.map((row) => row.id))
    }

    await tx.insert(preventionTrainingHistory).values({
      id: `ptrh-${nanoid()}`,
      entityType: TRAINING_OCCURRENCE_ENTITY_TYPE,
      entityId: input.occurrenceId,
      worksiteId: current.occurrence.worksiteId,
      changeType: "status_changed",
      reason: nextStatus === "completed"
        ? "Ocurrencia marcada como hecha con evidencia.": "Ocurrencia marcada como no hecha.",
      beforeState: {
        status: current.occurrence.status,
        version: current.occurrence.version,
        evidenceIds: activeEvidence.map((row) => row.id),
      },
      afterState: {
        status: nextStatus,
        version: updated.version,
        observation,
        annulledEvidenceIds,
      },
      actorUserId: access.userId,
    })

    await recordAudit({
      userId: access.userId,
      action: "status_change",
      entityType: TRAINING_OCCURRENCE_ENTITY_TYPE,
      entityId: input.occurrenceId,
      entityCode: current.catalog.code,
      oldState: { status: current.occurrence.status, version: current.occurrence.version },
      newState: { status: nextStatus, version: updated.version, observation, annulledEvidenceIds },
      reason: nextStatus === "completed"
        ? "Ocurrencia marcada como hecha con evidencia.": "Ocurrencia marcada como no hecha.",
    }, tx)

    const activityNumbers = (current.catalog.pdtpActivityNumbers as number[]) ?? []
    if (nextStatus === "completed" && activityNumbers.length > 0) {
      completionEvent = pdtpCompletionInput({
        occurrenceId: current.occurrence.id,
        worksiteId: current.occurrence.worksiteId,
        year: current.occurrence.year,
        scheduledMonth: current.occurrence.scheduledMonth,
        scheduledWeek: current.occurrence.scheduledWeek,
        activityNumbers,
        evidenceRef: activeEvidence[0]?.storagePath ?? null,
        catalogCode: current.catalog.code,
        catalogTitle: current.catalog.title,
        catalogVersion: current.catalog.catalogVersion,
        evidenceIds: activeEvidence.map((row) => row.id),
        actorUserId: access.userId,
      })
      await recordPendingPdtpFulfillmentEvent(completionEvent, tx)
    } else if (nextStatus === "not_completed" && current.occurrence.status === "completed" && activityNumbers.length > 0) {
      revocationEvent = pdtpRevocationInput(
        current.occurrence.id,
        current.occurrence.worksiteId,
        access.userId,
        observation ?? "La ocurrencia de capacitación fue corregida a no hecha.",
      )
      await recordPendingPdtpFulfillmentRevocation(revocationEvent, tx)
    }

    return { status: updated.status as TrainingOccurrenceStatus, version: updated.version }
  })

  if (completionEvent) await recordPdtpFulfillmentEvent(completionEvent)
  if (revocationEvent) await recordPdtpFulfillmentRevocation(revocationEvent)
  return result
}

export interface UploadTrainingOccurrenceEvidenceInput {
  occurrenceId: string
  fileName: string
  fileSize: number
  buffer: Uint8Array
}

export async function uploadTrainingOccurrenceEvidence(
  input: UploadTrainingOccurrenceEvidenceInput,
  access: TrainingOccurrenceAccess,
): Promise<TrainingOccurrenceEvidenceListItem> {
  requireAccess(access, "prevention:training:record")
  const fileName = input.fileName.trim()
  if (!fileName || fileName.length > 255) throw new Error("El nombre del archivo no es válido.")
  if (!Number.isSafeInteger(input.fileSize) || input.fileSize <= 0) {
    throw new Error("El tamaño del archivo no es válido.")
  }
  if (input.fileSize > TRAINING_OCCURRENCE_MAX_FILE_SIZE) {
    throw new Error(`El archivo supera el máximo permitido de ${Math.round(TRAINING_OCCURRENCE_MAX_FILE_SIZE / 1024 / 1024)} MB.`)
  }
  if (input.buffer.byteLength !== input.fileSize) {
    throw new Error("El contenido del archivo no coincide con su tamaño declarado.")
  }

  // Rechazar antes de escribir evita dejar un archivo huérfano cuando la
  // ocurrencia no existe, está cerrada o pertenece a otra faena. La transacción
  // repite la comprobación para conservar la garantía de carrera.
  const preflight = await loadOccurrenceForMutation(db, input.occurrenceId)
  if (!preflight || !preflight.worksiteActive || !preflight.catalog.isActive || !scopeAllows(access.scope, preflight.occurrence.worksiteId)) {
    throw new Error("Registro de capacitación no encontrado o fuera de alcance.")
  }

  const validation = validateFileBuffer(input.buffer, input.fileSize, MimeType.INSPECTION_DOCUMENT, fileName)
  if (validation.error) throw new Error(validation.error)

  const storageName = generateStorageName(fileName)
  const relativePath = createPreventionTrainingEvidencePath(storageName)
  const directory = resolvePreventionTrainingEvidenceDir()
  const absolutePath = resolveStorageFile(directory, storageName)
  const sha256 = createHash("sha256").update(input.buffer).digest("hex")

  await mkdirp(directory)
  await writeBuffer(absolutePath, Buffer.from(input.buffer))

  try {
    const result = await db.transaction(async (tx) => {
      const current = await loadOccurrenceForMutation(tx, input.occurrenceId)
      if (!current || !current.worksiteActive || !current.catalog.isActive || !scopeAllows(access.scope, current.occurrence.worksiteId)) {
        throw new Error("Registro de capacitación no encontrado o fuera de alcance.")
      }
      const [created] = await tx.insert(preventionTrainingOccurrenceEvidence).values({
        id: `ptoe-${nanoid()}`,
        occurrenceId: input.occurrenceId,
        fileName,
        storagePath: relativePath,
        mimeType: validation.mimeType,
        fileSizeBytes: input.fileSize,
        sha256,
        state: "active",
        uploadedByUserId: access.userId,
      }).returning()
      if (!created) throw new Error("No se pudo guardar la evidencia.")

      await recordAudit({
        userId: access.userId,
        action: "create",
        entityType: "training_occurrence_evidence",
        entityId: created.id,
        entityCode: current.catalog.code,
        newState: {
          occurrenceId: input.occurrenceId,
          fileName,
          storagePath: relativePath,
          mimeType: validation.mimeType,
          fileSizeBytes: input.fileSize,
          sha256,
        },
        reason: "Evidencia adjuntada a una ocurrencia de capacitación.",
      }, tx)
      return created
    })

    return {
      id: result.id,
      fileName: result.fileName,
      storagePath: result.storagePath,
      mimeType: result.mimeType,
      fileSizeBytes: result.fileSizeBytes,
      sha256: result.sha256,
      state: result.state,
      uploadedByUserId: result.uploadedByUserId,
      uploadedAt: result.uploadedAt,
      annulledAt: result.annulledAt,
      annulledReason: result.annulledReason,
    }
  } catch (error) {
    await removeFile(absolutePath).catch(() => undefined)
    throw error
  }
}

export async function getTrainingOccurrenceEvidenceForDownload(
  storageName: string,
  access: TrainingOccurrenceAccess,
) {
  requireAccess(access, "prevention:training:view")
  if (access.scope.mode === "none") return null
  const relativePath = createPreventionTrainingEvidencePath(storageName)
  const [row] = await db.select({
    evidence: preventionTrainingOccurrenceEvidence,
    worksiteId: preventionTrainingOccurrences.worksiteId,
  })
    .from(preventionTrainingOccurrenceEvidence)
    .innerJoin(preventionTrainingOccurrences, eq(preventionTrainingOccurrenceEvidence.occurrenceId, preventionTrainingOccurrences.id))
    .innerJoin(worksites, eq(preventionTrainingOccurrences.worksiteId, worksites.id))
    .where(and(
      eq(preventionTrainingOccurrenceEvidence.storagePath, relativePath),
      scopeCondition(access.scope, worksites.id),
    ))
    .limit(1)
  return row ?? null
}

export function trainingEvidenceContentDisposition(mimeType: string): "inline" | "attachment" {
  return mimeType === "application/pdf" || mimeType === "image/jpeg" || mimeType === "image/png"
    ? "inline"
    : "attachment"
}

function catalogItemToInsert(item: (typeof PREDEFINED_TRAINING_CATALOG)[number]) {
  return {
    id: trainingCatalogItemId(PREDEFINED_TRAINING_CATALOG_YEAR, item.code),
    code: item.code,
    title: item.title,
    itemType: item.itemType,
    audience: item.audience,
    catalogVersion: PREDEFINED_TRAINING_CATALOG_VERSION,
    sourceRow: item.sourceRow,
    scheduleJson: [...item.schedule],
    pdtpActivityNumbers: [...item.pdtpActivityNumbers],
    isActive: true,
    sortOrder: item.sortOrder,
  }
}

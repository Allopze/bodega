import { createHash } from "node:crypto"
import { and, asc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { z } from "zod"
import { db, type DB, type Tx } from "@/db"
import {
  preventionTrainingCatalogItems,
  preventionTrainingOccurrenceEvidence,
  preventionTrainingOccurrences,
  users,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { textSearchSql } from "@/lib/adquisiciones/list-query"
import { getPdtpOperationalYears } from "@/lib/services/pdtp/operational-years"
import { pdtpOverdueCutoffMonth, type PdtpPeriod } from "@/lib/services/pdtp/period"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { generateStorageName } from "@/lib/services/prevention-documents/utils"
import {
  PREDEFINED_TRAINING_CATALOG_YEAR,
  assertTrainingCatalogYear,
  isTrainingCatalogYear,
  resolveTrainingCatalogYear,
  occurrenceSeedRows,
  trainingCatalogSlotKeysForYear,
  trainingCatalogItemId,
  trainingCatalogItemsForYear,
  trainingCatalogVersionForYear,
  type PredefinedTrainingCatalogItem,
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
import { logger } from "@/lib/logger"
import { resolvePdtpAccreditationTarget } from "@/lib/services/pdtp/accreditation-bindings"
import {
  loadObligationBackedCatalogActivities,
  onTrainingOccurrenceCompleted,
} from "@/lib/services/pdtp-adapters/occurrence-gap-connector"
import { legacyPdtpActivityNumberForCatalogId } from "@/lib/services/pdtp-adapters/catalog-activities-2026"
import {
  propagateSlotStatusToPdtp,
  slotPdtpDeclaration,
  type SlotPdtpPropagationInput,
} from "@/lib/services/pdtp-adapters/slot-deviation-connector"

export const TRAINING_OCCURRENCE_MAX_FILE_SIZE = 25 * 1024 * 1024
// El margen cubre los campos multipart y los encabezados sin permitir que una
// petición con varios archivos grandes llegue a `formData()` antes de ser
// rechazada.
export const TRAINING_OCCURRENCE_MAX_REQUEST_SIZE = TRAINING_OCCURRENCE_MAX_FILE_SIZE + 256 * 1024
export const TRAINING_OCCURRENCE_ENTITY_TYPE = "training_occurrence"

type Client = DB | Tx

export type TrainingOccurrenceStatus = "pending" | "completed" | "not_completed" | "not_applicable"

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
  notApplicableReason: string | null
  evidence: TrainingOccurrenceEvidenceListItem[]
}

const statusSchema = z.enum(["completed", "not_completed", "not_applicable"])

/* El motivo es obligatorio para declarar "no aplica" y está prohibido en los
 * demás estados. Lo segundo importa tanto como lo primero: un motivo que
 * sobrevive a la corrección del estado termina mostrándose junto a una
 * capacitación realizada. El CHECK de la tabla impone la misma regla. */
const statusInputSchema = z.object({
  occurrenceId: z.string().trim().min(1).max(200),
  expectedVersion: z.number().int().positive(),
  status: statusSchema,
  observation: z.string().trim().max(3000).nullable().optional(),
  notApplicableReason: z.string().trim().max(1000).nullable().optional(),
}).superRefine((value, ctx) => {
  const reason = value.notApplicableReason?.trim() ?? ""
  if (value.status === "not_applicable" && reason.length < 10) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["notApplicableReason"],
      message: "Explica por qué la capacitación no aplica (al menos 10 caracteres).",
    })
  }
  if (value.status !== "not_applicable" && reason.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["notApplicableReason"],
      message: "El motivo de no aplicabilidad sólo corresponde al estado «no aplica».",
    })
  }
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

/** El motivo del cambio, para la bitácora y la auditoría.
 *
 * Existe porque el ternario binario que había acá trataba "no completed" como
 * sinónimo de "no hecha". Un estado nuevo que caiga en esa rama se ve bien en
 * pantalla y miente en el historial, que es el único registro que queda de un
 * estado anterior. */
const NOT_APPLICABLE_EVIDENCE_MESSAGE =
  "La capacitación está declarada como no aplicable: no admite evidencia."

function statusChangeReason(status: TrainingOccurrenceStatus, notApplicableReason: string | null): string {
  if (status === "completed") return "Ocurrencia marcada como hecha con evidencia."
  if (status === "not_applicable") return `Ocurrencia declarada no aplicable: ${notApplicableReason ?? "sin motivo"}`
  return "Ocurrencia marcada como no hecha."
}

/**
 * El año de capacitación que muestra una pantalla: el pedido (?year / ?anio) si
 * tiene catálogo publicado; si no, el año operativo del programa (PREV-C03.7);
 * y si ése tampoco tiene catálogo, el año base.
 */
export async function resolveTrainingOccurrenceYear(value: unknown): Promise<number> {
  const { primary } = await getPdtpOperationalYears()
  return resolveTrainingCatalogYear(value, isTrainingCatalogYear(primary) ? primary : PREDEFINED_TRAINING_CATALOG_YEAR)
}

function catalogInsertRows(year: number) {
  return trainingCatalogItemsForYear(year).map((item) => catalogItemToInsert(item, year))
}

/**
 * Inserta el catálogo controlado del año sin tocar estados ni evidencias
 * existentes. PREV-C03.4: el año es obligatorio; cada año tiene su versión
 * (`programa-capacitacion-<año>-v1`), así que sus ocurrencias acreditan el
 * programa de su año.
 */
export async function ensurePreventionTrainingCatalogTx(client: Client, year: number): Promise<void> {
  await client.insert(preventionTrainingCatalogItems)
    .values(catalogInsertRows(year))
    .onConflictDoNothing({ target: [
      preventionTrainingCatalogItems.catalogVersion,
      preventionTrainingCatalogItems.code,
    ] })
}

/**
 * Crea las posiciones del cronograma para una faena y un año. Es idempotente y
 * se usa tanto en el seed como al activar una faena nueva; nunca sobreescribe
 * una ocurrencia que ya tenga estado, observación o evidencia.
 */
export async function ensurePreventionTrainingOccurrencesForWorksiteTx(
  client: Client,
  worksiteId: string,
  year: number,
): Promise<number> {
  assertTrainingCatalogYear(year)
  await ensurePreventionTrainingCatalogTx(client, year)
  const catalogRows = await client.select({
    id: preventionTrainingCatalogItems.id,
    code: preventionTrainingCatalogItems.code,
  })
    .from(preventionTrainingCatalogItems)
    .where(and(
      eq(preventionTrainingCatalogItems.catalogVersion, trainingCatalogVersionForYear(year)),
      eq(preventionTrainingCatalogItems.isActive, true),
    ))

  const itemByCode = new Map(catalogRows.map((row) => [row.code, row.id]))
  const values = trainingCatalogItemsForYear(year).flatMap((item) => occurrenceSeedRows(item, worksiteId, year)
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
  year: number,
): Promise<number> {
  assertTrainingCatalogYear(year)
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

/** Las casillas `código:slotKey` que el catálogo del año pide; se calculan una vez por año (el catálogo es estático). */
const offeredSlotKeysCache = new Map<number, string[]>()
function offeredSlotKeys(year: number): string[] {
  let keys = offeredSlotKeysCache.get(year)
  if (!keys) {
    keys = [...trainingCatalogSlotKeysForYear(year)]
    offeredSlotKeysCache.set(year, keys)
  }
  return keys
}

/**
 * PRV-06: ¿el catálogo vigente todavía pide esta casilla? Una pendiente que ya
 * no está en el catálogo no se ofrece (marcarla hecha acreditaría una celda sin
 * plan); las que ya tienen estado se conservan, son historia.
 *
 * Es UNA sola condición, en SQL, y la comparten la lista, la lista paginada,
 * los contadores y el calendario de cumplimiento: si cada uno la reescribiera,
 * el calendario podría pintar de rojo una casilla que la lista no muestra, o
 * una pestaña contar una fila que la página nunca trae. Va en la consulta (y no
 * como filtro posterior en JS) porque el total y las páginas tienen que salir
 * de la base ya filtrados.
 */
function offeredOccurrenceSql(year: number): SQL {
  return or(
    ne(preventionTrainingOccurrences.status, "pending"),
    inArray(
      sql`${preventionTrainingCatalogItems.code} || ':' || ${preventionTrainingOccurrences.slotKey}`,
      offeredSlotKeys(year),
    ),
  ) as SQL
}

/**
 * Lo que toda lectura de ocurrencias del año comparte: el año, el catálogo
 * vigente y activo, el alcance del usuario y las casillas que el catálogo sigue
 * pidiendo. Cada lectura le suma su propia regla sobre las faenas inactivas.
 */
function occurrenceProgramConditions(access: TrainingOccurrenceAccess, year: number): SQL[] {
  const conditions = [
    eq(preventionTrainingOccurrences.year, year),
    eq(preventionTrainingCatalogItems.catalogVersion, trainingCatalogVersionForYear(year)),
    eq(preventionTrainingCatalogItems.isActive, true),
    offeredOccurrenceSql(year),
  ]
  const scope = scopeCondition(access.scope, worksites.id)
  if (scope) conditions.push(scope)
  return conditions
}

/** Una casilla del programa de capacitación, sin evidencia ni títulos: lo que el calendario necesita. */
export interface TrainingComplianceSlot {
  worksiteId: string
  worksiteName: string
  scheduledMonth: number | null
  scheduledWeek: number | null
  status: TrainingOccurrenceStatus
}

/**
 * Las casillas del año de TODAS las faenas del alcance, en su forma mínima,
 * para el calendario de cumplimiento faena × mes.
 *
 * Existe aparte de `listTrainingOccurrences` porque el calendario debe mostrar
 * todas las faenas aunque la lista esté filtrada a una, y porque no necesita
 * evidencia (la consulta de la lista trae miles de filas con su evidencia). El
 * alcance, el permiso, el catálogo vigente y las faenas activas son los mismos
 * de la lista; `includeWorksiteId` suma una faena inactiva sólo si el usuario
 * la eligió (historial de solo lectura), y siempre dentro de su alcance.
 */
export async function listTrainingComplianceSlots(
  access: TrainingOccurrenceAccess,
  filters: { year: number; includeWorksiteId?: string },
): Promise<TrainingComplianceSlot[]> {
  requireAccess(access, "prevention:training:view")
  if (access.scope.mode === "none") return []

  const year = filters.year
  if (!isTrainingCatalogYear(year)) return []
  const rows = await db.select({
    worksiteId: preventionTrainingOccurrences.worksiteId,
    worksiteName: worksites.name,
    scheduledMonth: preventionTrainingOccurrences.scheduledMonth,
    scheduledWeek: preventionTrainingOccurrences.scheduledWeek,
    status: preventionTrainingOccurrences.status,
  })
    .from(preventionTrainingOccurrences)
    .innerJoin(preventionTrainingCatalogItems, eq(preventionTrainingOccurrences.catalogItemId, preventionTrainingCatalogItems.id))
    .innerJoin(worksites, eq(preventionTrainingOccurrences.worksiteId, worksites.id))
    .where(and(
      ...occurrenceProgramConditions(access, year),
      filters.includeWorksiteId
        ? or(eq(worksites.isActive, true), eq(worksites.id, filters.includeWorksiteId))
        : eq(worksites.isActive, true),
    ))

  return rows.map((row) => ({
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    scheduledMonth: row.scheduledMonth,
    scheduledWeek: row.scheduledWeek,
    status: row.status as TrainingOccurrenceStatus,
  }))
}

interface OccurrenceListRow {
  occurrence: typeof preventionTrainingOccurrences.$inferSelect
  catalog: typeof preventionTrainingCatalogItems.$inferSelect
  worksiteName: string
  worksiteActive: boolean
  completedByName: string | null
}

/** La consulta de una fila de la lista, con sus uniones; cada lectura le pone su `where`, orden y límite. */
function selectOccurrenceListRows() {
  return db.select({
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
}

/** Pega la evidencia (sólo de las filas recibidas) y da a cada fila la forma de la lista. */
async function toOccurrenceListItems(rows: readonly OccurrenceListRow[]): Promise<TrainingOccurrenceListItem[]> {
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
    notApplicableReason: occurrence.notApplicableReason,
    evidence: evidenceByOccurrence.get(occurrence.id) ?? [],
  }))
}

/**
 * Todas las ocurrencias del año, sin paginar, con su evidencia. La usan la
 * exportación a Excel y el tablero de gobernanza, que necesitan el conjunto
 * completo; la pantalla de capacitación lee `listTrainingOccurrencesPage`.
 */
export async function listTrainingOccurrences(
  access: TrainingOccurrenceAccess,
  filters: { year: number; worksiteId?: string; includeInactiveWorksites?: boolean },
): Promise<TrainingOccurrenceListItem[]> {
  requireAccess(access, "prevention:training:view")
  if (access.scope.mode === "none") return []

  const year = filters.year
  if (!isTrainingCatalogYear(year)) return []
  const rows = await selectOccurrenceListRows()
    .where(and(
      ...occurrenceProgramConditions(access, year),
      filters.includeInactiveWorksites ? undefined : eq(worksites.isActive, true),
      filters.worksiteId ? eq(worksites.id, filters.worksiteId) : undefined,
    ))
    .orderBy(
      asc(worksites.name),
      sql`${preventionTrainingOccurrences.scheduledMonth} NULLS LAST`,
      asc(preventionTrainingOccurrences.scheduledWeek),
      asc(preventionTrainingCatalogItems.sortOrder),
      asc(preventionTrainingOccurrences.slotKey),
    )
  return toOccurrenceListItems(rows)
}

export type TrainingOccurrenceStatusFilter = TrainingOccurrenceStatus | "all"

/** Cuántas ocurrencias hay por estado, más el total (`all`). Un estado sin filas cuenta 0. */
export type TrainingOccurrenceStatusCounts = Record<TrainingOccurrenceStatus, number> & { all: number }

export interface TrainingOccurrencePageFilters {
  year: number
  worksiteId?: string
  /** Mostrar también las faenas inactivas (historial de sólo lectura); la página lo activa al elegir una faena. */
  includeInactiveWorksites?: boolean
  /** 1–12: sólo las casillas programadas ese mes (el mes que el usuario eligió en el calendario). */
  month?: number | null
  /** Por omisión `all`. Con `pending` la página llega ordenada por urgencia. */
  status?: TrainingOccurrenceStatusFilter
  /** Texto libre sobre código, título, faena y público. */
  search?: string
  /**
   * Desde cuándo exige el programa a CADA faena (`resolveProgramActivationPeriods`).
   * Una faena sin entrada, o con `null`, se exige desde el comienzo del año, igual
   * que en el calendario de cumplimiento. Sólo decide el orden de las pendientes.
   */
  activationByWorksite: Record<string, PdtpPeriod | null>
  /** Hoy (`currentPdtpPeriod()`): separa lo vencido, lo de este mes y lo futuro. */
  today: PdtpPeriod
  limit: number
  offset: number
}

export interface TrainingOccurrencePage {
  rows: TrainingOccurrenceListItem[]
  /** Filas del filtro de estado elegido (lo que se pagina). */
  total: number
  /** Por estado, con el mismo año, faena, mes y texto pero SIN el filtro de estado: cada pestaña cuenta lo que mostraría. */
  counts: TrainingOccurrenceStatusCounts
}

const EMPTY_STATUS_COUNTS: Readonly<TrainingOccurrenceStatusCounts> = {
  all: 0,
  pending: 0,
  completed: 0,
  not_completed: 0,
  not_applicable: 0,
}

/** Cuenta por estado las ocurrencias que cumplen `where` (que ya lleva sus uniones a catálogo y faena). */
async function countOccurrencesByStatus(where: SQL | undefined): Promise<TrainingOccurrenceStatusCounts> {
  const rows = await db.select({
    status: preventionTrainingOccurrences.status,
    count: sql<number>`count(*)::int`,
  })
    .from(preventionTrainingOccurrences)
    .innerJoin(preventionTrainingCatalogItems, eq(preventionTrainingOccurrences.catalogItemId, preventionTrainingCatalogItems.id))
    .innerJoin(worksites, eq(preventionTrainingOccurrences.worksiteId, worksites.id))
    .where(where)
    .groupBy(preventionTrainingOccurrences.status)
  const counts: TrainingOccurrenceStatusCounts = { ...EMPTY_STATUS_COUNTS }
  for (const row of rows) {
    const status = row.status as TrainingOccurrenceStatus
    if (!(status in counts)) continue
    counts[status] = Number(row.count)
    counts.all += Number(row.count)
  }
  return counts
}

/**
 * Los contadores por estado del año, sin traer ni una fila: lo que el tablero
 * de gobernanza necesita («pendientes», «declaradas no hechas») sin cargar las
 * miles de ocurrencias con su evidencia. Mismo alcance, catálogo, casillas
 * ofrecidas y reglas de faenas inactivas que la lista.
 */
export async function countTrainingOccurrencesByStatus(
  access: TrainingOccurrenceAccess,
  filters: { year: number; worksiteId?: string; includeInactiveWorksites?: boolean },
): Promise<TrainingOccurrenceStatusCounts> {
  requireAccess(access, "prevention:training:view")
  if (access.scope.mode === "none") return { ...EMPTY_STATUS_COUNTS }

  const year = filters.year
  if (!isTrainingCatalogYear(year)) return { ...EMPTY_STATUS_COUNTS }
  return countOccurrencesByStatus(and(
    ...occurrenceProgramConditions(access, year),
    filters.includeInactiveWorksites ? undefined : eq(worksites.isActive, true),
    filters.worksiteId ? eq(worksites.id, filters.worksiteId) : undefined,
  ))
}

/**
 * Las casillas ANTERIORES a la activación de su faena, como condición SQL: lo
 * que `isPdtpPeriodOnOrAfterActivationPeriod` niega, mes + semana, sobre cada
 * faena del mapa. Son pocas faenas (decenas como mucho), así que un `OR` de
 * cláusulas por faena es más simple que una tabla temporal y cabe en un índice.
 *
 * Una faena sin activación (`null` o ausente) se exige desde el comienzo del
 * año —el calendario la trata igual: `!activation` es «exigible»—, y una
 * activación de un año anterior no recorta nada del año consultado.
 */
function beforeActivationSql(year: number, activationByWorksite: Record<string, PdtpPeriod | null>): SQL | undefined {
  const month = preventionTrainingOccurrences.scheduledMonth
  const week = preventionTrainingOccurrences.scheduledWeek
  const clauses: SQL[] = []
  for (const [worksiteId, activation] of Object.entries(activationByWorksite)) {
    if (!activation || year > activation.year) continue
    if (year < activation.year) {
      clauses.push(sql`${preventionTrainingOccurrences.worksiteId} = ${worksiteId}`)
      continue
    }
    clauses.push(sql`(${preventionTrainingOccurrences.worksiteId} = ${worksiteId} AND (${month} < ${activation.month} OR (${month} = ${activation.month} AND ${week} < ${activation.week})))`)
  }
  return clauses.length === 0 ? undefined : or(...clauses)
}

/**
 * El cubo de urgencia de una casilla pendiente (0 es lo primero que hay que atender):
 *
 * 0. Vencida y exigible: su mes ya terminó y la faena ya estaba obligada.
 * 1. De este mes: pendiente, todavía no es deuda.
 * 2. Futura.
 * 3. Todavía no exigible (anterior a la activación de su faena) o sin mes
 *    programado: nadie le está pidiendo hacerla ahora.
 *
 * «Su mes ya terminó» usa el mismo corte que el calendario de cumplimiento
 * (`pdtpOverdueCutoffMonth`, el de `monthPhase`): un mes vence cuando termina.
 * Por eso lo que el calendario pinta de rojo es lo que esta lista muestra
 * primero, y el mes en curso no se mezcla con la deuda.
 */
function urgencyBucketSql(
  year: number,
  today: PdtpPeriod,
  activationByWorksite: Record<string, PdtpPeriod | null>,
): SQL {
  const month = preventionTrainingOccurrences.scheduledMonth
  const overdueThrough = pdtpOverdueCutoffMonth(year, today, today)
  const currentMonth = year === today.year ? today.month : 0
  const beforeActivation = beforeActivationSql(year, activationByWorksite)
  return sql`CASE
    WHEN ${month} IS NULL THEN 3
    ${beforeActivation ? sql`WHEN ${beforeActivation} THEN 3` : sql``}
    WHEN ${month} <= ${overdueThrough} THEN 0
    WHEN ${month} = ${currentMonth} THEN 1
    ELSE 2
  END`
}

/**
 * La lista de capacitación paginada y filtrada en la base. `listTrainingOccurrences`
 * traía las ~3.900 ocurrencias del año con su evidencia y la pantalla las pintaba
 * todas (30 MB de HTML); ésta trae sólo la página pedida y la evidencia de sus
 * filas, más los contadores de las pestañas.
 *
 * - `counts` cuenta por estado con el año, la faena, el mes y el texto pedidos
 *   pero SIN el filtro de estado, porque cada pestaña *es* un filtro de estado.
 * - `total` es lo que se pagina: `counts[status]`.
 * - Orden: con `status: "pending"` primero por urgencia (ver `urgencyBucketSql`);
 *   en cualquier estado después por mes, semana, faena, orden del catálogo,
 *   casilla e `id`, que desempata: sin un orden total dos páginas podían repetir
 *   o saltarse filas.
 */
export async function listTrainingOccurrencesPage(
  access: TrainingOccurrenceAccess,
  filters: TrainingOccurrencePageFilters,
): Promise<TrainingOccurrencePage> {
  requireAccess(access, "prevention:training:view")
  const empty: TrainingOccurrencePage = { rows: [], total: 0, counts: { ...EMPTY_STATUS_COUNTS } }
  if (access.scope.mode === "none") return empty

  const year = filters.year
  if (!isTrainingCatalogYear(year)) return empty

  const status = filters.status ?? "all"
  const limit = Math.max(1, Math.floor(filters.limit))
  const offset = Math.max(0, Math.floor(filters.offset))

  const baseWhere = and(
    ...occurrenceProgramConditions(access, year),
    filters.includeInactiveWorksites ? undefined : eq(worksites.isActive, true),
    filters.worksiteId ? eq(worksites.id, filters.worksiteId) : undefined,
    filters.month ? eq(preventionTrainingOccurrences.scheduledMonth, filters.month) : undefined,
    textSearchSql(filters.search ?? "", [
      preventionTrainingCatalogItems.code,
      preventionTrainingCatalogItems.title,
      worksites.name,
      preventionTrainingCatalogItems.audience,
    ]),
  )
  const rowsWhere = status === "all"
    ? baseWhere
    : and(baseWhere, eq(preventionTrainingOccurrences.status, status))

  const [counts, pageRows] = await Promise.all([
    countOccurrencesByStatus(baseWhere),
    selectOccurrenceListRows()
      .where(rowsWhere)
      .orderBy(
        ...(status === "pending" ? [urgencyBucketSql(year, filters.today, filters.activationByWorksite)] : []),
        sql`${preventionTrainingOccurrences.scheduledMonth} ASC NULLS LAST`,
        sql`${preventionTrainingOccurrences.scheduledWeek} ASC NULLS LAST`,
        asc(worksites.name),
        asc(preventionTrainingCatalogItems.sortOrder),
        asc(preventionTrainingOccurrences.slotKey),
        asc(preventionTrainingOccurrences.id),
      )
      .limit(limit)
      .offset(offset),
  ])

  return {
    rows: await toOccurrenceListItems(pageRows),
    total: counts[status],
    counts,
  }
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
  activityNumbers?: number[]
  catalogActivityIds?: string[]
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
    ...(args.catalogActivityIds?.length ? { catalogActivityIds: args.catalogActivityIds } : { activityNumbers: args.activityNumbers }),
    occurredAt: nowIso(),
    executedQuantity: 1,
    evidenceRef: args.evidenceRef ?? undefined,
    autoApproveByUserId: args.actorUserId,
    actorUserId: args.actorUserId,
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

/**
 * Task 8 (ronda de corrección 1, 2026-09-22): las actividades `on_demand`
 * medidas por plazo (N°16 y N°57 desde esta tarea) se acreditan por
 * OBLIGACIÓN (`onTrainingOccurrenceCompleted` → `reportSubjectObligation`),
 * no por acreditación directa de la ocurrencia: `closed_on_time`
 * (`lib/services/pdtp/compliance.ts`) ignora las ejecuciones y sólo mira
 * obligaciones, así que una fila directa en `pdtpExecutions` no aporta nada
 * y sólo duplica el registro — el mismo motivo por el que
 * `worker-onboarding-connector.ts` excluye la N°15/N°52 de su acreditación
 * directa (`OBLIGATION_ACTIVITY_NUMBERS` ahí).
 *
 * Acá se resuelve de forma genérica contra el mismo mapa que ya usa el
 * barrido de brechas (`loadObligationBackedCatalogActivities`), no a mano:
 * cualquier ítem `on_demand`+`closed_on_time` que se agregue al catálogo en
 * el futuro queda cubierto sin tocar esta función.
 *
 * `target` puede venir como números legados o como `catalogActivityIds` de
 * vínculos ya migrados (`resolvePdtpAccreditationTarget`); en el segundo caso
 * se resuelve cada id a su número legado (`legacyPdtpActivityNumberForCatalogId`,
 * mismo puente que usa `lib/services/pdtp/fulfillment.ts`) para poder
 * comparar contra el mapa, que siempre habla en números.
 */
function excludeObligationBackedFromAccreditationTarget(
  target: { catalogActivityIds?: string[]; activityNumbers?: number[] },
  obligationBackedNumbers: readonly number[],
): { catalogActivityIds?: string[]; activityNumbers?: number[] } {
  if (obligationBackedNumbers.length === 0) return target
  const backed = new Set(obligationBackedNumbers)
  if (target.activityNumbers?.length) {
    const filtered = target.activityNumbers.filter((n) => !backed.has(n))
    return filtered.length > 0 ? { activityNumbers: filtered } : {}
  }
  if (target.catalogActivityIds?.length) {
    const filtered = target.catalogActivityIds.filter((id) => {
      const legacyNumber = legacyPdtpActivityNumberForCatalogId(id)
      return legacyNumber === null || !backed.has(legacyNumber)
    })
    return filtered.length > 0 ? { catalogActivityIds: filtered } : {}
  }
  return target
}

export async function recordTrainingOccurrenceStatus(
  rawInput: unknown,
  access: TrainingOccurrenceAccess,
): Promise<{ status: TrainingOccurrenceStatus; version: number }> {
  requireAccess(access, "prevention:training:record")
  const input = statusInputSchema.parse(rawInput)
  let completionEvent: (AccreditationInput & { sourceVersion: string; returnHref: string; plannedYear: number; plannedPeriod?: { year: number; month: number; week: number } }) | null = null
  let revocationEvent: RevocationInput | null = null
  /* El cierre de la obligación del PDTP (N°57 y cualquier otra actividad a
   * demanda medida por plazo) va fuera de la transacción, igual que el evento
   * de acreditación: son dos mecanismos distintos —obligación y cumplimiento—
   * y ninguno de los dos debe poder abortar el registro del operador. */
  let obligationReport: { occurrenceId: string; catalogItemId: string; worksiteId: string; completedAt: string } | null = null
  /* El «no aplica»/«no hecha» de una ocurrencia que salía de «hecha» se
   * refleja en el PDTP después del commit y de la revocación, no adentro: la
   * ejecución acreditada sigue viva hasta que `recordPdtpFulfillmentRevocation`
   * la pasa a borrador, y el PDTP rechaza un «no aplica» sobre una celda con
   * ejecución. Los demás cambios van en la transacción de la ocurrencia. */
  let postCommitPdtpDeviation: SlotPdtpPropagationInput | null = null
  /* Fuera de la transacción, igual que en el barrido de brechas: sólo lee el
   * programa activo y el catálogo, no depende de la ocurrencia que se está
   * mutando. Se resuelve una vez y se usa para excluir de la acreditación
   * directa las actividades que ya se acreditan por obligación. */
  const obligationBackedByItem = await loadObligationBackedCatalogActivities()

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
    const notApplicableReason = nextStatus === "not_applicable"
      ? (input.notApplicableReason?.trim() || null)
      : null
    const [updated] = await tx.update(preventionTrainingOccurrences).set({
      status: nextStatus,
      completedAt: nextStatus === "completed" ? now : null,
      completedByUserId: nextStatus === "completed" ? access.userId : null,
      notApplicableAt: nextStatus === "not_applicable" ? now : null,
      notApplicableByUserId: nextStatus === "not_applicable" ? access.userId : null,
      notApplicableReason,
      observation,
      version: current.occurrence.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionTrainingOccurrences.id, input.occurrenceId),
      eq(preventionTrainingOccurrences.version, input.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La capacitación cambió mientras la editabas. Recarga y reintenta.")

    /* Cualquier estado que no sea "hecha" anula la evidencia activa, no sólo
     * "no hecha": una ocurrencia declarada no aplicable tampoco puede quedar
     * con evidencia colgando. Se anula en vez de borrarse porque esa evidencia
     * pudo haber acreditado el programa, y su rastro es lo que explica por qué
     * se contó y después se descontó. */
    const annulledEvidenceIds: string[] = []
    if (nextStatus !== "completed" && activeEvidence.length > 0) {
      const annulled = await tx.update(preventionTrainingOccurrenceEvidence).set({
        state: "annulled",
        annulledByUserId: access.userId,
        annulledAt: now,
        annulledReason: nextStatus === "not_applicable"
          ? "La ocurrencia se declaró no aplicable; la evidencia anterior se conserva como historial."
          : "La ocurrencia fue corregida a no hecha; la evidencia anterior se conserva como historial.",
      }).where(and(
        eq(preventionTrainingOccurrenceEvidence.occurrenceId, input.occurrenceId),
        eq(preventionTrainingOccurrenceEvidence.state, "active"),
      )).returning({ id: preventionTrainingOccurrenceEvidence.id })
      annulledEvidenceIds.push(...annulled.map((row) => row.id))
    }

    /* Antes acá había además un insert en `prevention_training_history`, que
     * duplicaba exactamente lo que el `recordAudit` de abajo ya escribe. Era el
     * único de los once historiales de prevención cuyo servicio sí llamaba al
     * log compartido, así que es el único que se retira sin migrar nada: lo que
     * guardaba ya estaba guardado dos líneas más abajo. */

    await recordAudit({
      userId: access.userId,
      action: "status_change",
      entityType: TRAINING_OCCURRENCE_ENTITY_TYPE,
      entityId: input.occurrenceId,
      entityCode: current.catalog.code,
      oldState: { status: current.occurrence.status, version: current.occurrence.version },
      newState: { status: nextStatus, version: updated.version, observation, notApplicableReason, annulledEvidenceIds },
      reason: statusChangeReason(nextStatus, notApplicableReason),
    }, tx)

    const activityNumbers = (current.catalog.pdtpActivityNumbers as number[]) ?? []
    const target = await resolvePdtpAccreditationTarget({ sourceType: "capacitacion_ocurrencia", sourceId: current.catalog.id, eventType: "close", legacyActivityNumbers: activityNumbers }, tx)
    /* Sólo para acreditación directa (completar/revocar). La propagación de
     * desvíos más abajo usa `target` sin filtrar a propósito: es un mecanismo
     * distinto (refleja «no aplica»/«no hecha» en la celda planificada del
     * PDTP, no acredita nada) y ya es tolerante a actividades sin celda
     * (`propagateSlotStatusToPdtp` no hace nada si la ocurrencia es `annual`,
     * como las N°16/N°57). */
    const directTarget = excludeObligationBackedFromAccreditationTarget(
      target,
      obligationBackedByItem.get(current.catalog.id) ?? [],
    )
    if (nextStatus === "completed" && (directTarget.catalogActivityIds?.length || directTarget.activityNumbers?.length)) {
      completionEvent = pdtpCompletionInput({
        occurrenceId: current.occurrence.id,
        worksiteId: current.occurrence.worksiteId,
        year: current.occurrence.year,
        scheduledMonth: current.occurrence.scheduledMonth,
        scheduledWeek: current.occurrence.scheduledWeek,
        ...directTarget,
        evidenceRef: activeEvidence[0]?.storagePath ?? null,
        catalogCode: current.catalog.code,
        catalogTitle: current.catalog.title,
        catalogVersion: current.catalog.catalogVersion,
        evidenceIds: activeEvidence.map((row) => row.id),
        actorUserId: access.userId,
      })
      await recordPendingPdtpFulfillmentEvent(completionEvent, tx)
    }
    if (nextStatus === "completed") {
      obligationReport = {
        occurrenceId: current.occurrence.id,
        catalogItemId: current.catalog.id,
        worksiteId: current.occurrence.worksiteId,
        completedAt: now,
      }
    } else if (current.occurrence.status === "completed" && (directTarget.catalogActivityIds?.length || directTarget.activityNumbers?.length)) {
      /* La condición era `nextStatus === "not_completed"` literal. Con un tercer
       * estado eso dejaba viva la acreditación de una ocurrencia corregida a
       * "no aplica": el programa la seguía contando como cumplida. Lo que
       * revoca es SALIR de "hecha" —cosa que esta rama `else` ya garantiza—, no
       * el destino concreto. */
      revocationEvent = pdtpRevocationInput(
        current.occurrence.id,
        current.occurrence.worksiteId,
        access.userId,
        notApplicableReason
          ?? observation
          ?? "La ocurrencia de capacitación dejó de estar cumplida.",
      )
      await recordPendingPdtpFulfillmentRevocation(revocationEvent, tx)
    }

    /* «No aplica»/«no hecha» llega a la celda del PDTP de la misma actividad
     * que la ocurrencia acreditaría al cumplirse (`target`), en su período
     * planificado. «Hecha» no pasa por acá: la acreditación ya retira el
     * desvío de la celda que acredita. */
    if (nextStatus !== "completed" && (target.catalogActivityIds?.length || target.activityNumbers?.length)) {
      const label = `de capacitación ${current.catalog.code} ${current.occurrence.slotKey}`
      const propagation: SlotPdtpPropagationInput = {
        source: { module: "capacitacion", slotId: current.occurrence.id, label },
        worksiteId: current.occurrence.worksiteId,
        cell: { year: current.occurrence.year, month: current.occurrence.scheduledMonth, week: current.occurrence.scheduledWeek },
        activities: target.catalogActivityIds?.length
          ? { catalogActivityIds: target.catalogActivityIds }
          : { activityNumbers: target.activityNumbers ?? [] },
        next: slotPdtpDeclaration(updated, label),
        previous: slotPdtpDeclaration(current.occurrence, label),
        userId: access.userId,
      }
      if (current.occurrence.status === "completed") postCommitPdtpDeviation = propagation
      else await propagateSlotStatusToPdtp(tx, propagation)
    }

    return { status: updated.status as TrainingOccurrenceStatus, version: updated.version }
  })

  if (completionEvent) await recordPdtpFulfillmentEvent(completionEvent)
  if (revocationEvent) await recordPdtpFulfillmentRevocation(revocationEvent)
  if (postCommitPdtpDeviation) {
    const propagation: SlotPdtpPropagationInput = postCommitPdtpDeviation
    // El conector no lanza; esto cubre que falle la transacción misma (la
    // conexión), que tampoco puede convertir en error un cambio ya confirmado.
    await db.transaction((tx) => propagateSlotStatusToPdtp(tx, propagation)).catch((err: unknown) => {
      logger.error({ err, occurrenceId: propagation.source.slotId }, "[training-occurrences] No se pudo reflejar el estado de la ocurrencia en el PDTP.")
    })
  }
  /* Se desestructura en vez de esparcir: TypeScript no propaga a este punto
   * los tipos de las asignaciones hechas dentro del callback de la
   * transacción, así que un spread acá no compila. Es el mismo motivo por el
   * que `completionEvent` se pasa entero y no expandido. */
  if (obligationReport) {
    const { occurrenceId, catalogItemId, worksiteId, completedAt } = obligationReport
    await onTrainingOccurrenceCompleted({
      occurrenceId, catalogItemId, worksiteId, completedAt, userId: access.userId,
    })
  }
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
  /* Una ocurrencia declarada no aplicable no admite evidencia: se declaró que
   * la actividad no correspondía, así que no hay nada que respaldar. Se
   * comprueba acá y de nuevo dentro de la transacción, igual que el alcance:
   * el preflight evita el archivo huérfano, la transacción cierra la carrera. */
  if (preflight.occurrence.status === "not_applicable") {
    throw new Error(NOT_APPLICABLE_EVIDENCE_MESSAGE)
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
      if (current.occurrence.status === "not_applicable") {
        throw new Error(NOT_APPLICABLE_EVIDENCE_MESSAGE)
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

function catalogItemToInsert(item: PredefinedTrainingCatalogItem, year: number) {
  return {
    id: trainingCatalogItemId(year, item.code),
    code: item.code,
    title: item.title,
    itemType: item.itemType,
    audience: item.audience,
    catalogVersion: trainingCatalogVersionForYear(year),
    sourceRow: item.sourceRow,
    scheduleJson: [...item.schedule],
    pdtpActivityNumbers: [...item.pdtpActivityNumbers],
    isActive: true,
    sortOrder: item.sortOrder,
  }
}

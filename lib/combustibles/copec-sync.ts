import { createHash } from "node:crypto"
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords, fuelImportBatches, fuelProviderRejections, fuelProviderSyncRuns, fuelProviderTransactions, fuelStorageLocations, systemSettings, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { todayInChile, addDaysToPlainDate } from "@/lib/utils"
import { parseCopecDetail, type ParsedConsumptionRow } from "@/lib/combustibles/consumption-import"
import { computeBatchTotals } from "@/lib/combustibles/consumption-calculations"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"
import { listProviderPendingItems, type ProviderPendingItem } from "@/lib/combustibles/provider-pending-items"
import { loadVehicleResolver, NOT_IN_FLEET } from "@/lib/combustibles/plate-resolver"
import { splitAggregateByDay, type DaySplitPart } from "@/lib/combustibles/copec-day-split"
import { saveMeterReadings } from "@/lib/combustibles/meter-readings"
import { AUTOMATED_SOURCES, copecTctSource } from "@/lib/combustibles/fuel-sources"
import { fuelProductIdForLegacy } from "@/lib/combustibles/fuel-products"
import { emptyUnbackedProviderBatches, isOpenPeriod, providerBatchKey, replaceBatchRecords } from "@/lib/combustibles/open-period"
import {
  beginFuelProviderSyncRun,
  closeStaleFuelProviderSyncRuns,
  finishFuelProviderSyncRun,
  listOpenCopecRejections,
  markCopecEventsSuperseded,
  recordFuelProviderIssues,
  recordFuelProviderValidation,
  type CopecOpenRejection,
} from "@/lib/combustibles/fuel-provider-ledger"
import { validateProviderRows, type ProviderRowInput } from "@/lib/combustibles/provider-validation"
import { reconcileFuelProviderRun } from "@/lib/combustibles/fuel-reconciliation"
import {
  CopecReportFailure,
  type CopecSession,
  type CopecReportDownloadResult,
  type CopecDownloadedReport,
} from "@/lib/combustibles/copec-reports"
import { COPEC_WS_PARSER_VERSION, withCopecWebServiceSession } from "@/lib/combustibles/copec-ws"
import { parseTaeReceiptRecords } from "@/lib/combustibles/tae-receipt-import"
import { importTaeReceipts, TaeSupplierMissingError } from "@/lib/combustibles/tae-receipts"
import { archiveCopecEvidence, removeCopecEvidence } from "@/lib/combustibles/copec-evidence"

import { buildCopecTransactionRows, hasPossibleCopecCorrection } from "@/lib/combustibles/copec-events"
import {
  canCloseCopecPeriodWithIssues,
  canConfirmCopecEmpty,
  copecCoverageStatusOf,
  findNextCopecCoverageMonth,
  isTerminalCopecCoverage,
  type CopecCoverageChannel,
  type CopecCoverageProduct,
  type CopecCoverageStatus,
} from "@/lib/combustibles/copec-coverage"
import { closeCopecPeriodWithIssues, listCopecPeriodCoverage, recordCopecFile, recordCopecPeriodCoverage, updateCopecFileParseResult } from "@/lib/combustibles/copec-coverage-store"
import { isValidReason, reasonRequiredMessage } from "@/lib/validation/reason-thresholds"

const STATE_KEY = "combustibles.copec.sync"
const START_KEY = "COPEC_SYNC_START_DATE"
const DEFAULT_START = "2021-01-01"

/**
 * `taeCursor` es el cursor del canal TAE, independiente del de TCT.
 *
 * `advanced` mide sólo los informes TCT a propósito (ver el docblock de
 * `importTaeReceiptPeriod`), así que un mes en que TCT entregaba y TAE no hacía
 * avanzar el cursor igual: esas recepciones —la etapa `received` del ciclo
 * físico— no se reintentaban nunca más.
 *
 * Va en la misma fila y no en una clave aparte para que las dos posiciones se
 * guarden en la misma escritura optimista: con dos filas, un fallo entre medio
 * dejaba un canal avanzado y el otro no.
 */
interface SyncState { cursor: string | null; taeCursor: string | null; requestedStart?: string | null; lastRunAt: string | null; pending: string[]; }

/**
 * Tope de meses TCT por corrida.
 *
 * El cron corta a los 5 minutos (`maxDuration = 300`). Sin tope, una
 * instalación sin cursor planifica desde `DEFAULT_START` —más de 60 meses— y
 * una corrida lenta podría morir por timeout en el mismo lugar sin avanzar del
 * todo. Con tope, la cobertura avanza los meses cerrados que sí quedaron
 * verificados. Con el web service un período tarda segundos, así que el tope
 * sólo importa si Copec se pone lento.
 *
 * C10: 6 y no 4. El barrido ya corta por tiempo (`SWEEP_BUDGET_MS`) y con el
 * web service un mes tarda segundos; con 4, una instalación nueva con un mes
 * trabado al frente necesitaba una corrida por mes de histórico.
 */
const MAX_PERIODS_PER_RUN = 6

/** Tiempo después del cual el cron no empieza otro período (ver `syncCopecReports`). */
const SWEEP_BUDGET_MS = 150_000

/**
 * Una corrida con estado `running` más vieja que esto no puede seguir viva: el
 * proceso que la abrió fue matado por la plataforma (`maxDuration`), y su
 * `catch` nunca corrió. Se cierra como fallida al empezar la corrida siguiente
 * para que ninguna quede abierta para siempre (C7 / hallazgo 4.7).
 */
const STALE_RUN_MS = 20 * 60 * 1000

export interface CopecSyncStartOptions {
  currentStart: string
  minimumStart: string
  maximumStart: string
  latestImportedUntil: string | null
}

async function state(): Promise<SyncState & { _version: string }> {
  const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, STATE_KEY) })
  if (!row) return { cursor: null, taeCursor: null, requestedStart: null, lastRunAt: null, pending: [], _version: "" }
  try { return { ...{ cursor: null, taeCursor: null, requestedStart: null, lastRunAt: null, pending: [], _version: row.updatedAt ?? "" }, ...JSON.parse(row.value) } }
  catch { return { cursor: null, taeCursor: null, requestedStart: null, lastRunAt: null, pending: [], _version: "" } }
}

export interface CopecCoverageStatusView {
  channel: "TCT" | "TAE"
  product: "diesel" | "bluemax"
  status: CopecCoverageStatus
  /** Misma regla que valida la acción de confirmar vacío (`canConfirmCopecEmpty`). */
  canConfirmEmpty: boolean
  /** C1/E6: se puede cerrar el mes con motivo aunque el informe trajera filas inválidas. */
  canCloseWithIssues: boolean
  /** Por qué no se puede cerrar, para que la pantalla no ofrezca un botón que va a fallar. */
  closeWithIssuesBlockedReason: string | null
  rowsReceived: number
  rowsAccepted: number
  rowsRejected: number
  rowsPending: number
  /** Motivo y fecha con que se cerró un mes con observaciones, si lo hubo. */
  evidence: string | null
  evidenceActorUserId: string | null
  updatedAt: string
}

export interface CopecSyncStateView {
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunMonth: string | null
  rowsReceived: number
  rowsAccepted: number
  rowsRejected: number
  rowsPending: number
  affectedQuantity: number
  affectedAmount: number
  cursor: string | null
  pending: number
  pendingItems: ProviderPendingItem[]
  coverageMonth: string
  coverage: CopecCoverageStatusView[]
  /** C2: correcciones y filas inválidas que esperan una decisión humana. */
  openRejections: CopecOpenRejection[]
}

export async function getCopecSyncState(): Promise<CopecSyncStateView> {
  const [s, latestRun, nextUncovered] = await Promise.all([
    state(),
    db.query.fuelProviderSyncRuns.findFirst({ where: eq(fuelProviderSyncRuns.provider, "copec"), orderBy: [desc(fuelProviderSyncRuns.startedAt)] }),
    firstUncoveredMonth(),
  ])
  // C4: el listado de pendientes se muestra si CUALQUIERA de las dos
  // granularidades dejó filas sin asignar. `rowsPending` de la corrida ya suma
  // eventos y proyección; el umbral se mantiene sobre ese total.
  const pendingItems = latestRun && latestRun.rowsPending > 0 ? await listProviderPendingItems(latestRun.id) : []
  const openRejections = await listOpenCopecRejections({ limit: 25 })
  const coverageMonth = monthKey(nextUncovered)
  const persistedCoverage = await listCopecPeriodCoverage(coverageMonth, lastDayOfMonth(coverageMonth))
  const coverage = (["TCT", "TAE"] as const).flatMap((channel) => (["diesel", "bluemax"] as const).map((product) => {
    const row = persistedCoverage.find((item) => item.channel === channel && item.product === product)
    const closable = canCloseCopecPeriodWithIssues(row)
    return {
      channel,
      product,
      status: row ? copecCoverageStatusOf(row) : "unknown",
      canConfirmEmpty: canConfirmCopecEmpty(row),
      canCloseWithIssues: closable.ok,
      closeWithIssuesBlockedReason: closable.ok ? null : closable.reason,
      rowsReceived: row?.rowsReceived ?? 0,
      rowsAccepted: row?.rowsAccepted ?? 0,
      rowsRejected: row?.rowsRejected ?? 0,
      rowsPending: row?.rowsPending ?? 0,
      evidence: row?.evidence ?? null,
      evidenceActorUserId: row?.evidenceActorUserId ?? null,
      updatedAt: row?.updatedAt ?? new Date().toISOString(),
    }
  }))
  return {
    lastRunAt: latestRun?.finishedAt ?? latestRun?.startedAt ?? s.lastRunAt,
    lastRunStatus: latestRun?.status ?? null,
    // El mes de esa corrida: sin él, sus filas pendientes se leían como un problema de hoy.
    lastRunMonth: latestRun?.requestedFrom ?? null,
    rowsReceived: latestRun?.rowsReceived ?? 0,
    rowsAccepted: latestRun?.rowsAccepted ?? 0,
    rowsRejected: latestRun?.rowsRejected ?? 0,
    rowsPending: latestRun?.rowsPending ?? 0,
    affectedQuantity: latestRun?.affectedQuantity ?? 0,
    affectedAmount: latestRun?.affectedAmount ?? 0,
    cursor: s.cursor,
    pending: latestRun?.rowsPending ?? s.pending.length,
    pendingItems,
    coverageMonth,
    coverage,
    openRejections
  }
}

/**
 * Cierre de un canal/producto/mes con evidencia (C1, decisión E6).
 *
 * Vive acá y no en la acción para que la regla —mes cerrado, sin pendientes de
 * mapeo, con motivo y operador— quede en el mismo módulo que la cobertura y se
 * pueda probar contra la base sin sesión.
 */
export async function closeCopecPeriodWithIssuesFor(input: {
  month: string
  channel: CopecCoverageChannel
  product: CopecCoverageProduct
  reason: string
  actorUserId: string
  actorEmail?: string | null
}): Promise<CopecSyncStateView> {
  if (!isValidIsoDate(input.month) || !input.month.endsWith("-01")) throw new Error("El mes debe empezar el día 1")
  if (!isValidReason(input.reason)) throw new Error(reasonRequiredMessage("la evidencia revisada para cerrar el mes con observaciones"))
  const end = lastDayOfMonth(input.month)
  if (isOpenPeriod(end)) throw new Error("No se puede cerrar un mes que todavía está abierto")
  await closeCopecPeriodWithIssues({
    month: input.month,
    channel: input.channel,
    product: input.product,
    reason: input.reason,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
  })
  return getCopecSyncState()
}

/**
 * `expectedVersion` es el `updatedAt` leído por la llamada a `state()` que
 * originó este guardado (`""` si la fila no existía aún). Antes se pisaba a
 * ciegas: dos corridas del cron solapadas —o un cron y un ajuste manual de
 * fecha de inicio— podían leer el mismo estado y la segunda escritura
 * descartaba en silencio el avance de cursor de la primera (CO-026).
 * `setWhere` sólo aplica la actualización si nadie escribió entre medio. La
 * creación inicial usa un INSERT separado con `DO NOTHING`: PostgreSQL castea
 * todos los parámetros antes de decidir si ejecuta la rama de conflicto, por
 * lo que pasar `""` a una comparación `timestamptz` fallaba incluso cuando la
 * fila todavía no existía.
 */
async function saveState(next: SyncState, expectedVersion: string) {
  const value = JSON.stringify(next)
  const now = new Date().toISOString()
  const [result] = expectedVersion === ""
    ? await db.insert(systemSettings)
      .values({ key: STATE_KEY, value, updatedAt: now })
      .onConflictDoNothing({ target: systemSettings.key })
      .returning({ key: systemSettings.key })
    : await db.insert(systemSettings)
      .values({ key: STATE_KEY, value, updatedAt: now })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: now },
        setWhere: eq(systemSettings.updatedAt, expectedVersion),
      })
      .returning({ key: systemSettings.key })
  if (!result) {
    throw new Error("El estado de sincronización Copec cambió en otra ejecución. Reintenta desde el estado actual.")
  }
}

// Fecha civil chilena: en UTC (la zona del proceso en producción), entre las
// 21:00 y la medianoche de Chile el 1º del mes ya llegó, y el cálculo del mes
// cerraba un mes de más. Todo lo que dependa del mes en curso —el tope del plan
// y el piso de la fecha de inicio— tiene que pasar por acá, no por `new Date()`.
function today(): string { return todayInChile() }

function addDays(value: string, days: number): string { return addDaysToPlainDate(value, days) }

function firstDayOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`
}

function shiftMonth(value: string, delta: number): string {
  const date = new Date(`${firstDayOfMonth(value)}T00:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() + delta)
  return date.toISOString().slice(0, 10)
}

function nextMonth(value: string): string { return shiftMonth(value, 1) }

function lastDayOfMonth(value: string): string {
  return addDays(nextMonth(value), -1)
}

function monthKey(value: string): string { return `${value.slice(0, 7)}-01` }

function exactTotal(values: number[], scale: 100 | 10_000): number {
  const units = values.reduce((sum, value) => sum + BigInt(Math.round(value * scale)), BigInt(0))
  return Number(units) / scale
}

/** Keep channel extraction failures local so TAE can run even if TCT fails. */
/**
 * «No hay registros…» (`no_records`) en un mes CERRADO es la respuesta de Copec
 * de que la cuenta no tuvo ese producto ese mes: se registra como vacío
 * confirmado, con esa evidencia y el importador como responsable. Si no,
 * quedaría «desconocido» y el mes no avanzaría hasta que alguien lo confirmara
 * a mano, todos los meses (TAE BlueMax casi nunca tiene cargas).
 * Un mes abierto no se cierra así: el producto puede aparecer más adelante.
 * Devuelve si lo registró.
 */
/** Agregado mensual TCT repartido por día entre faenas (`copec-day-split.ts`). */
export const SPLIT_BY_DAY_CODE = "split_by_day"

const EMPTY_OPEN_MONTH_NOTE = "sin cargas todavía en el mes en curso"

/**
 * El mes en curso respondió «No hay registros» con el acceso confirmado: el
 * producto simplemente no tiene cargas aún. No es una caída de la fuente, así
 * que no va a `unavailable` (que vuelve `partial` la corrida y 503 el cron: el
 * mes abierto se barre primero, así que eso pasaba casi todos los días). Sin
 * acceso confirmado (`no_results`) sí puede ser un problema de credenciales y
 * sigue contando como no disponible.
 */
function isEmptyOpenMonth(download: CopecReportDownloadResult, to: string): boolean {
  return download.unavailable && download.reason === "no_records" && isOpenPeriod(to)
}

async function recordDisabledProductAsEmpty(input: {
  download: CopecReportDownloadResult
  channel: "TCT" | "TAE"
  from: string
  to: string
  importerId: string
  runId?: string
}): Promise<boolean> {
  const { download, channel, from, to } = input
  if (!download.unavailable || download.reason !== "no_records" || isOpenPeriod(to)) return false
  const productLabel = download.product === "diesel" ? "Diésel" : "BlueMax"
  const month = monthKey(from).slice(0, 7)
  const observed = `El web service de Copec respondió «No hay registros para el filtro seleccionado» para ${channel} ${productLabel} en ${month}`
  await recordCopecPeriodCoverage({
    channel,
    product: download.product,
    month: monthKey(from),
    status: "legitimate_empty",
    sourceAvailability: "available",
    syncRunId: input.runId,
    evidence: `${observed}: la cuenta no tuvo ese producto en el mes. Confirmado por la sincronización.`,
    evidenceActorUserId: input.importerId,
  })
  return true
}

async function downloadCopecChannel(
  session: CopecSession,
  requests: Array<{ product: "diesel" | "bluemax"; from: string; to: string }>,
  channel: "TCT" | "TAE",
): Promise<CopecReportDownloadResult[]> {
  try {
    return await session.download(requests, channel)
  } catch (error) {
    if (!(error instanceof CopecReportFailure)) throw error
    return requests.map(({ product }) => ({
      product,
      unavailable: false as const,
      failure: { kind: error.kind, message: error.message },
    }))
  }
}

async function archiveDownloadedCopecReport(input: {
  runId: string
  channel: "TCT" | "TAE"
  product: "diesel" | "bluemax"
  from: string
  report: CopecDownloadedReport
}): Promise<string> {
  const id = nanoid()
  // Se archiva lo que entregó Copec, no las filas traducidas: la respuesta del
  // web service es la evidencia.
  const format = /\.json$/i.test(input.report.fileName) ? "json" : "xml"
  const evidence = await archiveCopecEvidence(id, input.report.buffer, format)
  try {
    await recordCopecFile({
      id,
      syncRunId: input.runId,
      provider: "copec",
      sourceAccount: `${input.channel.toLowerCase()}:${input.product}`,
      channel: input.channel,
      product: input.product,
      periodMonth: monthKey(input.from),
      originalFileName: input.report.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-160) || "copec-report.xlsx",
      storagePath: evidence.storagePath,
      sourceSha256: evidence.sourceSha256,
      encryptedSha256: evidence.encryptedSha256,
      encryptionIv: evidence.encryptionIv,
      encryptionAuthTag: evidence.encryptionAuthTag,
      encryptionKeyVersion: evidence.encryptionKeyVersion,
      parserVersion: COPEC_WS_PARSER_VERSION,
      sourceBytes: evidence.sourceBytes,
      status: "archived",
    })
  } catch (error) {
    // C10 / 4.11: el `.enc` se escribe ANTES de la fila. Si la fila no entra (o
    // el período falla después), el archivo quedaba huérfano sin nada que lo
    // nombre. Se compensa acá; la evidencia no se pierde porque no hay fila que
    // la referencie.
    await removeCopecEvidence(evidence.storagePath).catch(() => {})
    throw error
  }
  return id
}

/**
 * Eventos ya registrados del mes para una cuenta, contra los que se detectan
 * correcciones posibles. La ventana va de medianoche UTC del día 1 a las 06:00
 * UTC del mes siguiente: cubre el mes civil chileno (UTC-3/-4) completo.
 *
 * C2 / 4.2: esta lista es lo que hace que una corrección converja o no.
 * - La fila `:correction-review` NO es evidencia previa: es la propuesta que
 *   está esperando revisión. Incluirla hacía que cada corrida se comparara
 *   contra sí misma y volviera a marcar la misma corrección para siempre.
 * - Una fila `superseded` (`replaced`) ya fue reemplazada por la corrección
 *   aprobada. Compararla de nuevo reintroducía el mismo bucle.
 */
async function priorCopecEvents(accountKey: string, from: string, to: string) {
  return db.query.fuelProviderTransactions.findMany({
    where: and(
      eq(fuelProviderTransactions.provider, "copec"),
      eq(fuelProviderTransactions.sourceAccount, accountKey),
      gte(fuelProviderTransactions.occurredAt, `${from}T00:00:00.000Z`),
      lte(fuelProviderTransactions.occurredAt, `${nextMonth(to)}T06:00:00.000Z`),
      notInArray(fuelProviderTransactions.status, ["superseded", "replaced"]),
    ),
    columns: { id: true, sourceRowKey: true, sourcePlate: true, status: true },
  }).then((rows) => rows
    .filter((row) => !row.sourceRowKey.endsWith(CORRECTION_REVIEW_SUFFIX))
    .map((row) => ({ id: row.id, sourceRowKey: row.sourceRowKey, plate: row.sourcePlate })))
}

/** Sufijo con que se registra una corrección propuesta (no aplicada). */
const CORRECTION_REVIEW_SUFFIX = ":correction-review"

/**
 * Si dos claves de fila describen la MISMA carga candidata: mismo prefijo —la
 * guía de despacho, o el vehículo y el día cuando no hay guía— y sólo cambia la
 * firma o la ocurrencia. Es la relación que una corrección reemplaza.
 */
function sameGuideOrDay(left: string, right: string): boolean {
  const marker = ":sig:"
  const leftIndex = left.lastIndexOf(marker)
  const rightIndex = right.lastIndexOf(marker)
  if (leftIndex < 0 || rightIndex < 0) return false
  return left.slice(0, leftIndex + 1) === right.slice(0, rightIndex + 1)
}

/**
 * Cotas de texto con que se buscan las decisiones de corrección de un mes.
 *
 * `occurredAt` es un instante ISO con hora, así que `<= to` («2026-03-31»)
 * dejaba fuera todo el último día y lo del 31 después de las 21:00 de Chile (ya
 * abril en UTC): esas decisiones no se encontraban y la corrección se volvía a
 * marcar en cada corrida (4.2). El techo es el de `priorCopecEvents`; el piso es
 * la fecha sola, que cubre tanto «2026-03-01» como «2026-03-01T…».
 */
export function copecDecisionWindow(from: string, to: string): { lower: string; upper: string } {
  return { lower: from, upper: `${nextMonth(to)}T06:00:00.000Z` }
}

/**
 * Decisiones humanas ya tomadas sobre las correcciones de ese mes, por clave de
 * la fila de revisión. `resolved` = la corrección se aprueba y en esta corrida
 * se aplica; `dismissed` = se revisó y la evidencia original se mantiene.
 */
async function copecCorrectionDecisions(accountKey: string, from: string, to: string): Promise<Map<string, "open" | "resolved" | "dismissed">> {
  const window = copecDecisionWindow(from, to)
  const rows = await db.query.fuelProviderRejections.findMany({
    where: and(
      eq(fuelProviderRejections.provider, "copec"),
      eq(fuelProviderRejections.sourceAccount, accountKey),
      gte(fuelProviderRejections.occurredAt, window.lower),
      lte(fuelProviderRejections.occurredAt, window.upper),
    ),
    columns: { sourceRowKey: true, status: true, code: true },
  })
  return new Map(rows
    .filter((row) => row.code === "possible_provider_correction" || row.code === "tae_guide_correction_review")
    .map((row) => [row.sourceRowKey.replace(CORRECTION_REVIEW_SUFFIX, ""), row.status as "open" | "resolved" | "dismissed"]))
}

function isValidIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function configuredStart(): string {
  const configuredStart = process.env[START_KEY]?.trim()
  if (isValidIsoDate(configuredStart)) return configuredStart
  return DEFAULT_START
}

async function latestActiveImportUntil(): Promise<string | null> {
  const batch = await db.query.fuelImportBatches.findFirst({
    where: ne(fuelImportBatches.estado, "revertido"),
    columns: { periodoHasta: true },
    orderBy: [desc(fuelImportBatches.periodoHasta)],
  })
  return isValidIsoDate(batch?.periodoHasta) ? batch.periodoHasta : null
}

async function firstUncoveredMonth(current?: SyncState): Promise<string> {
  const configured = firstDayOfMonth(configuredStart())
  const horizon = lastDayOfMonth(today())
  const rows = await listCopecPeriodCoverage(configured, horizon)
  const uncovered = findNextCopecCoverageMonth(rows, configured, horizon) ?? firstDayOfMonth(today())
  const requested = current?.requestedStart
  // A manual date can request an earlier verification pass, but it cannot skip
  // an unknown or failed product/channel month.
  return isValidIsoDate(requested) && requested < uncovered ? firstDayOfMonth(requested) : uncovered
}

/** Hash estable de la proyección TCT. El Excel puede regenerarse con otro
 * nombre o metadata sin que cambie el agregado que se proyecta.
 *
 * `invalidRows` entra al hash aunque no se proyecte: sin él, un archivo que gana
 * una fila inválida sin cambiar ninguna válida salía por el atajo de "hash
 * idéntico, no hay trabajo" y el lote se quedaba con su conteo de filas
 * rechazadas viejo para siempre.
 *
 * Las filas se ORDENAN por patente antes de hashear. Copec regenera el Excel en
 * cada descarga, así que su orden de filas no es parte del contenido: hashearlo
 * en orden de archivo hacía que un reordenamiento sin ningún cambio de datos
 * invalidara el hash y disparara un `replaceBatchRecords` completo, con
 * `updated_at` nuevo en todos los registros del lote. */
export function copecProjectionHash(rows: ParsedConsumptionRow[], invalidRows = 0): string {
  return createHash("sha256")
    .update(JSON.stringify({
      invalidRows,
      rows: [...rows]
        .sort((left, right) => plateMatchKey(left.patente).localeCompare(plateMatchKey(right.patente)))
        .map((row) => ({
        patente: row.patente,
        tarjetas: row.numeroTarjetas,
        transacciones: row.numeroTransacciones,
        cantidad: row.cantidadUnidad,
        monto: row.monto,
        rendimiento: row.rendimientoPromedio,
      })),
    }))
    .digest("hex")
}

export async function getCopecSyncStartOptions(): Promise<CopecSyncStartOptions> {
  const [current, latestImportedUntil] = await Promise.all([state(), latestActiveImportUntil()])
  const minimumStart = firstDayOfMonth(configuredStart())
  return {
    currentStart: await firstUncoveredMonth(current),
    minimumStart,
    maximumStart: firstDayOfMonth(today()),
    latestImportedUntil,
  }
}

export async function setCopecSyncStartDate(startDate: string, expectedStart: string): Promise<CopecSyncStartOptions> {
  if (!isValidIsoDate(startDate)) throw new Error("La fecha de inicio no es válida")
  if (!startDate.endsWith("-01")) throw new Error("Selecciona el primer día del mes desde el que quieres sincronizar")

  const [current, latestImportedUntil] = await Promise.all([state(), latestActiveImportUntil()])
  const minimumStart = firstDayOfMonth(configuredStart())
  const currentStart = await firstUncoveredMonth(current)
  if (currentStart !== expectedStart) {
    throw new Error("La sincronización cambió mientras ajustabas la fecha. Actualiza la página e inténtalo nuevamente.")
  }

  const maximumStart = firstDayOfMonth(today())
  if (startDate < minimumStart) throw new Error("La fecha no puede ser anterior al inicio configurado para la cuenta Copec.")
  if (startDate > maximumStart) {
    throw new Error("La importación automática solo puede comenzar hasta el mes actual.")
  }
  if (startDate > currentStart) throw new Error("No se puede saltar un mes sin cobertura verificada por canal y producto.")

  await saveState({ cursor: current.cursor, taeCursor: current.taeCursor, requestedStart: startDate, lastRunAt: current.lastRunAt, pending: current.pending }, current._version)
  return { currentStart: startDate, minimumStart, maximumStart, latestImportedUntil }
}

/**
 * Clave de fila del ledger para una carga TCT.
 *
 * Va por PATENTE y no por índice de fila. El informe TCT es un agregado mensual
 * por patente, así que la patente es su clave natural; el índice de fila, en
 * cambio, es posición en un Excel que Copec REGENERA en cada descarga, y en el
 * informe de detalle es además la fila de la primera transacción de esa patente.
 * Una transacción corregida corría el índice y el ledger ganaba una segunda
 * transacción para la misma patente y mes, con la vieja huérfana para siempre.
 *
 * `from:to:product` es obligatorio: `identity_key` no lleva el período y su
 * índice único es (proveedor, cuenta, identidad), así que sin él dos meses con
 * la misma patente colisionarían y el upsert pisaría el historial.
 *
 * Existe como función porque la cadena se arma en un lado y se RECONSTRUYE en
 * otro para filtrar qué filas entran a la proyección: desincronizarlas deja el
 * lote vacío sin lanzar ningún error.
 */
export function copecSourceRowKey(from: string, to: string, product: string, patente: string): string {
  return `${from}:${to}:${product}:${plateMatchKey(patente)}`
}

export interface CopecSyncPeriod { from: string; to: string }

/** Copec consulta a lo más 31 días, por eso cada período es un mes calendario. */
export function buildCopecSyncPeriods(from: string, to: string): CopecSyncPeriod[] {
  const firstMonth = firstDayOfMonth(from)
  if (firstMonth > to) return []
  const periods: CopecSyncPeriod[] = []
  for (let cursor = firstMonth; cursor <= to; cursor = nextMonth(cursor)) {
    const end = lastDayOfMonth(cursor)
    if (end > to) break
    periods.push({ from: cursor, to: end })
  }
  return periods
}

export async function getCopecSyncPlan(): Promise<{ from: string; to: string; periods: CopecSyncPeriod[]; pending: number }> {
  const current = await state()
  const from = await firstUncoveredMonth(current)
  // Incluye el mes en curso: su lote se refresca en cada corrida.
  const all = buildCopecSyncPeriods(from, lastDayOfMonth(today()))
  // `to` sigue al recorte, no al horizonte: la UI muestra el plan de ESTA
  // corrida, y anunciar un `to` que los períodos no alcanzan es mentirle.
  const periods = all.slice(0, MAX_PERIODS_PER_RUN)
  const to = periods.at(-1)?.to ?? lastDayOfMonth(today())
  return { from, to, periods, pending: current.pending.length }
}

interface PeriodSyncResult {
  imported: number
  /** Registros de un período abierto cuyos totales se actualizaron. */
  refreshed: number
  pending: number
  /** Patentes sin vehículo vistas EN ESTE período. */
  pendingPlates: string[]
  /** Solo informes TCT. El guard de "Copec no entregó nada" se mide con esto:
   *  si un informe TAE contara aquí, una caída de TCT avanzaría el cursor igual. */
  reports: string[]
  /**
   * Copec NO entregó el informe (o lo entregó y no se pudo leer): el producto
   * quedó sin datos por una causa externa. Es lo único que degrada el contrato
   * del cron (C6): una fila inválida o un mapeo pendiente son trabajo humano,
   * no una fuente caída.
   */
  unavailable: string[]
  /** Observaciones que no implican que la fuente falló (filas inválidas, mapeos pendientes, correcciones). */
  notes: string[]
  /** Recepciones del canal TAE (etapa `received` del ciclo físico). */
  received: number
  /** Informes TAE que Copec sí entregó. Decide el cursor TAE, igual que
   *  `reports` decide el de TCT. */
  taeReports: number
  /** Tarjetas TAE sin vasija asociada: su combustible no entró al ciclo. */
  unmappedCards: string[]
  rowsReceived: number
  rowsAccepted: number
  rowsRejected: number
  rowsPending: number
  /** Lecturas de odómetro rescatadas del informe de detalle. */
  meterReadings: number
}

async function importCopecPeriod(
  session: CopecSession,
  from: string,
  to: string,
  pending: Set<string>,
  importerId?: string,
  runId?: string,
  /** Se va llenando a medida que el ledger escribe, para que una caída a mitad
   *  de camino no cierre la corrida diciendo que no se procesó nada. */
  quality?: { accepted: number; rejected: number; pending: number },
): Promise<PeriodSyncResult> {
  const importerEmail = process.env.COPEC_SYNC_IMPORTER_EMAIL?.trim()
  const configuredImporter = importerId
    ? null
    : importerEmail
    ? await db.query.users.findFirst({ where: and(eq(users.email, importerEmail), eq(users.isActive, true)), columns: { id: true } })
    : null
  const resolvedImporterId = importerId ?? configuredImporter?.id
  if (!resolvedImporterId) throw new Error("No hay un usuario activo para registrar la sincronización Copec. Configura COPEC_SYNC_IMPORTER_EMAIL para la ejecución automática.")

  let imported = 0
  let refreshed = 0
  const reports: string[] = []
  const unavailable: string[] = []
  const notes: string[] = []
  let rowsReceived = 0
  let rowsAccepted = 0
  let rowsRejected = 0
  let rowsPending = 0
  let meterReadings = 0
  /** Lotes que los informes de ESTE período respaldan; el resto se vacía. */
  const backedBatches = new Set<string>()
  const cleanupEligibleSources = new Set<string>()
  const downloads = await downloadCopecChannel(
    session,
    (["diesel", "bluemax"] as const).map((product) => ({ product, from, to })),
    "TCT",
  )
  for (const download of downloads) {
    const { product } = download
    const productLabel = product === "diesel" ? "Diesel" : "BlueMax"
    const source = copecTctSource(product)
    if (download.unavailable) {
      if (await recordDisabledProductAsEmpty({ download, channel: "TCT", from, to, importerId: resolvedImporterId, runId })) continue
      // Mes en curso sin cargas todavía: no es una caída de la fuente.
      if (isEmptyOpenMonth(download, to)) notes.push(`${productLabel}: ${EMPTY_OPEN_MONTH_NOTE}`)
      else unavailable.push(productLabel)
      await recordCopecPeriodCoverage({ channel: "TCT", product, month: monthKey(from), status: "unknown", sourceAvailability: "unavailable", syncRunId: runId })
      continue
    }
    if ("failure" in download) {
      unavailable.push(`${productLabel}: [${download.failure.kind}] ${download.failure.message}`)
      await recordCopecPeriodCoverage({ channel: "TCT", product, month: monthKey(from), status: "failed", sourceAvailability: "unknown", syncRunId: runId })
      continue
    }
    const { report } = download
    if (!runId) throw new Error("La evidencia Copec requiere una corrida durable asociada")
    const sourceFileId = await archiveDownloadedCopecReport({ runId, channel: "TCT", product, from, report })
    reports.push(`${productLabel}:${report.fileName}`)
    const parseContext = { expectedProduct: product, period: { from, to } }
    const parsed = parseCopecDetail(report.records, parseContext)
    const parserVersion = COPEC_WS_PARSER_VERSION
    const sourceRowsReceived = (parsed.transactions?.length ?? 0) > 0 ? parsed.transactions!.length + parsed.errors.length : parsed.rows.length + parsed.errors.length
    rowsReceived += sourceRowsReceived
    const accountKey = `tct:${product}`
    const parsedQuantity = exactTotal(parsed.rows.map((row) => row.cantidadUnidad), 10_000)
    const parsedAmount = exactTotal(parsed.rows.map((row) => row.monto), 100)
    const parserErrors = parsed.errors.map((error) => ({
      input: {
        provider: "copec" as const,
        accountKey,
        sourceRowKey: `${from}:${to}:${product}:error:${error.rowIndex}`,
        externalId: null,
        occurredAt: from,
        sourceDate: from,
        plate: null,
        product,
        quantity: null,
        amount: null,
        payload: error,
      },
      code: "source_row_invalid",
      message: `${error.field}: ${error.message}`,
    }))
    // C1 / 4.1: una fila inválida NO puede dejar el mes entero sin proyectar.
    // Antes, cualquier `parsed.error` mandaba el producto a `failed` y hacía
    // `continue`: las 9 filas buenas del mismo archivo se perdían, el mes
    // quedaba no-terminal para siempre (`failed` con filas no se puede
    // confirmar vacío ni saltar) y el barrido abortaba en cada corrida. Ahora
    // las inválidas se persisten como rechazos y las válidas siguen su camino;
    // el mes queda `incomplete` hasta que una persona lo cierre con evidencia
    // (`closeCopecPeriodWithIssues`).
    //
    // Un archivo SIN filas válidas sigue igual que antes: no hay nada que
    // proyectar y el mes queda `failed` a la espera de una persona.
    const hasInvalidParserRows = parsed.errors.length > 0
    if (hasInvalidParserRows) {
      const rejectedCount = parsed.errors.length
      rowsRejected += rejectedCount
      if (quality) quality.rejected += rejectedCount
      if (parserErrors.length) await recordFuelProviderIssues(runId, parserErrors)
      notes.push(`${productLabel}: ${rejectedCount} fila(s) inválida(s) del informe, rechazadas y guardadas`)
    }
    if (parsed.rows.length === 0) {
      const rejectedCount = parsed.errors.length || 1
      if (!hasInvalidParserRows) rowsRejected += rejectedCount
      if (quality && !hasInvalidParserRows) quality.rejected += rejectedCount
      notes.push(`${productLabel}: archivo vacío sin evidencia de período vacío`)
      await updateCopecFileParseResult({ id: sourceFileId, status: "invalid", rowsReceived: sourceRowsReceived, rowsAccepted: 0, rowsRejected: rejectedCount, quantityTotal: parsedQuantity, amountTotal: parsedAmount })
      await recordCopecPeriodCoverage({ channel: "TCT", product, month: monthKey(from), status: "failed", sourceAvailability: "available", syncRunId: runId, sourceFileId, rowsReceived: sourceRowsReceived, rowsAccepted: 0, rowsRejected: rejectedCount, quantityTotal: parsedQuantity, amountTotal: parsedAmount, parserVersion })
      continue
    }
    const validationInputs: ProviderRowInput[] = parsed.rows.map((row) => ({
      provider: "copec",
      accountKey,
      sourceRowKey: copecSourceRowKey(from, to, product, row.patente),
      externalId: null,
      // La PROYECCIÓN es un agregado mensual por patente, así que su evidencia
      // en el ledger se fecha al inicio del período y el rango solicitado sigue
      // siendo la frontera de validación.
      //
      // Ojo: el ARCHIVO sí trae fecha y hora por transacción — el informe de
      // detalle entrega una fila por carga, con odómetro y estación de servicio.
      // Ese nivel no se pierde: viaja a `fuel_meter_readings` por su cuenta (ver
      // `saveMeterReadings` más abajo). Este `from` describe la granularidad de
      // la proyección, no la del archivo.
      occurredAt: from,
      sourceDate: from,
      periodEnd: to,
      plate: row.patente,
      product,
      quantity: row.cantidadUnidad,
      unitPrice: null,
      amount: row.monto,
      payload: row.rawRow,
      // La fila del informe TCT es el agregado del MES para esa patente, no una
      // carga: declararlo evita que la conciliación la cruce contra una carga
      // interna por fecha y monto y la marque `unmatched` sin significado.
      granularity: "period_aggregate" as const,
    }))
    const validation = validateProviderRows(validationInputs, { from, to })
    // Un solo resolutor para el ledger y para la proyección: eran dos bloques
    // idénticos, cada uno con su propia consulta del padrón y de los mappings.
    const resolveVehicle = await loadVehicleResolver({ provider: "copec", sourceAccount: accountKey })
    const eventRows = buildCopecTransactionRows(from, to, product, parsed.transactions ?? [], "TCT")
    const priorEvents = eventRows.length > 0 ? await priorCopecEvents(accountKey, from, to) : []
    const correctionDecisions = eventRows.length > 0 ? await copecCorrectionDecisions(accountKey, from, to) : new Map<string, "open" | "resolved" | "dismissed">()
    const correctionReviewRows: ProviderRowInput[] = []
    const acceptedEventInputs: ProviderRowInput[] = []
    /** Filas previas que la corrección aprobada reemplaza: pasan a `superseded`. */
    const supersededEventIds: string[] = []
    for (let index = 0; index < eventRows.length; index++) {
      const row = eventRows[index]!
      const earlierRows = eventRows.slice(0, index).map((previous) => ({ sourceRowKey: previous.sourceRowKey, plate: previous.plate }))
      if (!hasPossibleCopecCorrection(row.sourceRowKey, [...priorEvents, ...earlierRows], row.plate)) {
        acceptedEventInputs.push(row)
        continue
      }
      const decision = correctionDecisions.get(row.sourceRowKey)
      // C2 / 4.2: una corrección REVISADA se aplica. `resolved` reemplaza la
      // evidencia previa (la original queda `superseded`, que es lo que la saca
      // del bucle de comparación); `dismissed` mantiene la original y descarta
      // esta observación. Sin decisión —o con la revisión abierta— la fila
      // sigue en revisión, que es el único caso que deja el mes `incomplete`.
      if (decision === "resolved") {
        for (const previous of priorEvents) if (sameGuideOrDay(row.sourceRowKey, previous.sourceRowKey) && previous.sourceRowKey !== row.sourceRowKey) supersededEventIds.push(previous.id)
        acceptedEventInputs.push(row)
        continue
      }
      if (decision === "dismissed") continue
      correctionReviewRows.push({ ...row, sourceRowKey: `${row.sourceRowKey}${CORRECTION_REVIEW_SUFFIX}` })
    }
    if (supersededEventIds.length > 0) {
      await markCopecEventsSuperseded(supersededEventIds, { reason: "Corrección del proveedor aprobada en revisión", actorUserId: resolvedImporterId, runId })
      notes.push(`${productLabel}: ${supersededEventIds.length} carga(s) previa(s) reemplazadas por la corrección aprobada`)
    }
    const eventValidation = validateProviderRows(acceptedEventInputs, { from, to })
    const hasEventDetail = eventRows.length > 0
    // § 9.3 (decisión 2026-11-05): el agregado de una patente reasignada a mitad
    // de mes se reparte por día con el detalle de transacciones. Sólo con un
    // archivo sano: con correcciones o filas inválidas el detalle está en duda.
    const daySplits = new Map<string, DaySplitPart[]>()
    if (hasEventDetail && correctionReviewRows.length === 0 && eventValidation.rejected.length === 0 && validation.rejected.length === 0) {
      for (const row of parsed.rows) {
        if (resolveVehicle(row.patente, from, to) || !resolveVehicle.inFleet(row.patente)) continue
        const plate = plateMatchKey(row.patente)
        const split = splitAggregateByDay({
          aggregate: row,
          transactions: (parsed.transactions ?? []).filter((transaction) => plateMatchKey(transaction.plate) === plate),
          resolveOnDay: (day) => resolveVehicle(row.patente, day, day),
        })
        if (split.ok) daySplits.set(row.patente, split.parts)
        else notes.push(`${productLabel}: ${row.patente} no se repartió por día (${split.reason})`)
      }
    }
    // Una patente que no está en la flota (p. ej. un vehículo de otra empresa en
    // la misma cuenta Copec) no cuenta ni queda pendiente: no hay nada que
    // asignar. Una patente de la flota sin asignación para el mes sí queda
    // pendiente, porque ese consumo es propio y falta decidir a qué faena va.
    const persistedProjection = await recordFuelProviderValidation(runId, validation, (input) => {
      const vehicle = input.plate ? resolveVehicle(input.plate, input.sourceDate ?? from, input.periodEnd ?? input.sourceDate ?? to) : undefined
      if (!vehicle && input.plate && !resolveVehicle.inFleet(input.plate)) return { excluded: NOT_IN_FLEET }
      // Repartido por día: los litros los cuentan las transacciones (cada una con
      // la faena de su día) y los lotes por faena; el agregado ya no está pendiente.
      const parts = !vehicle && input.plate ? daySplits.get(input.plate) : undefined
      if (parts) return { excluded: { code: SPLIT_BY_DAY_CODE, message: `Repartido por día entre ${parts.length === 1 ? "1 faena" : `${parts.length} faenas`} según la asignación de cada carga` } }
      return { worksiteId: vehicle?.worksiteId, vehicleId: vehicle?.id, productId: fuelProductIdForLegacy(input.product) }
    }, { sourceFileId })
    const persistedEvents = await recordFuelProviderValidation(runId, eventValidation, (input) => {
      const vehicle = input.plate ? resolveVehicle(input.plate, input.sourceDate ?? input.occurredAt ?? from) : undefined
      if (!vehicle && input.plate && !resolveVehicle.inFleet(input.plate)) return { excluded: NOT_IN_FLEET }
      return { worksiteId: vehicle?.worksiteId, vehicleId: vehicle?.id, productId: fuelProductIdForLegacy(input.product) }
    }, { sourceFileId })
    const correctionIssues = correctionReviewRows.map((input) => ({
      input,
      code: "possible_provider_correction",
      message: "El mismo identificador de guía o vehículo/fecha aparece con datos distintos; requiere revisión antes de reemplazar la evidencia previa.",
    }))
    const persistedCorrections = correctionIssues.length ? await recordFuelProviderIssues(runId, correctionIssues) : { rejected: 0 }
    const trackedRows = eventRows.length > 0 ? persistedEvents : persistedProjection
    rowsAccepted += trackedRows.accepted
    rowsRejected += trackedRows.rejected + (persistedCorrections.rejected ?? 0)
    // C4 / 4.4: `rowsPending` suma LAS DOS granularidades. Con detalle TCT, la
    // proyección mensual y las transacciones por día resuelven por caminos
    // distintos: un vehículo reasignado a mitad de mes deja pendiente el
    // agregado y aceptadas las transacciones. Contar sólo una dejaba
    // `rowsPending = 0` con la cobertura `incomplete` y la pantalla decía «sin
    // pendientes» sin nombrar qué patrón arreglar.
    const pendingRowsTotal = trackedRows.pending + (eventRows.length > 0 ? persistedProjection.pending : 0)
    rowsPending += pendingRowsTotal
    if (quality) {
      quality.accepted += trackedRows.accepted
      quality.rejected += trackedRows.rejected + (persistedCorrections.rejected ?? 0)
      quality.pending += pendingRowsTotal
    }
    const validationFailed = validation.rejected.length > 0 || eventValidation.rejected.length > 0
    const hasCorrections = correctionReviewRows.length > 0
    // Una patente sin vehículo NO detiene la proyección: sus filas quedan
    // `pending` en el ledger y fuera de los lotes (ver el loop de abajo), y el
    // mes queda `incomplete` hasta vincularla. Detener aquí dejaba sin consumos
    // el producto completo del mes —el mes en curso incluido— por un solo
    // equipo nuevo. Filas inválidas o correcciones sí detienen: ahí lo que está
    // en duda es el contenido del archivo, no a quién se le atribuye.
    const mappingsPending = persistedProjection.pending > 0 || persistedEvents.pending > 0
    if (validationFailed || hasCorrections) {
      const rejectedCount = validation.rejected.length + eventValidation.rejected.length + (persistedCorrections.rejected ?? 0)
      const acceptedCount = eventRows.length > 0 ? eventRows.length - correctionReviewRows.length - eventValidation.rejected.length : persistedProjection.accepted
      const coverageStatus = validationFailed ? "failed" : "incomplete"
      await updateCopecFileParseResult({ id: sourceFileId, status: validationFailed ? "invalid" : "processed", rowsReceived: sourceRowsReceived, rowsAccepted: acceptedCount, rowsRejected: rejectedCount, rowsPending: pendingRowsTotal, quantityTotal: parsedQuantity, amountTotal: parsedAmount })
      await recordCopecPeriodCoverage({ channel: "TCT", product, month: monthKey(from), status: coverageStatus, sourceAvailability: "available", syncRunId: runId, sourceFileId, rowsReceived: sourceRowsReceived, rowsAccepted: acceptedCount, rowsRejected: rejectedCount, rowsPending: pendingRowsTotal, quantityTotal: parsedQuantity, amountTotal: parsedAmount, parserVersion })
      notes.push(`${productLabel}: ${validationFailed ? "validación de filas requiere revisión" : "corrección pendiente de revisión"}`)
      continue
    }
    const groups = new Map<string, ParsedConsumptionRow[]>()
    /** Vehículo de cada fila repartida por día: la patente no resuelve para el mes entero. */
    const splitVehicleIds = new WeakMap<ParsedConsumptionRow, string>()
    const acceptedIdentityKeys = new Set(validation.accepted.map((row) => row.identityKey))
    let cleanupSafe = !isOpenPeriod(to) && hasEventDetail && !mappingsPending
    for (const row of parsed.rows) {
      const sourceRowKey = copecSourceRowKey(from, to, product, row.patente)
      if (!acceptedIdentityKeys.has(`row:copec:${accountKey}:${sourceRowKey}`)) continue
      const vehicle = resolveVehicle(row.patente, from, to)
      // Fuera de la flota: no es consumo propio, así que no bloquea la limpieza.
      if (!vehicle && !resolveVehicle.inFleet(row.patente)) continue
      if (!vehicle) {
        const parts = daySplits.get(row.patente)
        if (parts) {
          for (const part of parts) {
            const partRow: ParsedConsumptionRow = {
              ...row,
              numeroTransacciones: part.transactions,
              cantidadUnidad: part.liters,
              monto: part.amount,
              rawRow: { ...row.rawRow, repartoPorDia: { desde: part.from, hasta: part.to, transacciones: part.transactions, litrosDelMes: row.cantidadUnidad, montoDelMes: row.monto } },
            }
            splitVehicleIds.set(partRow, part.vehicleId)
            const partRows = groups.get(part.worksiteId) ?? []
            partRows.push(partRow); groups.set(part.worksiteId, partRows)
          }
          continue
        }
        pending.add(row.patente); cleanupSafe = false; continue
      }
      const rows = groups.get(vehicle.worksiteId) ?? []
      rows.push(row); groups.set(vehicle.worksiteId, rows)
    }
    // Las lecturas de odómetro no pertenecen a ningún lote: su identidad es la
    // guía de despacho de la transacción, no (faena, período, producto). Se
    // guardan una vez por archivo y fuera del loop por faena, con upsert, así que
    // una corrección del proveedor en un mes abierto las alcanza igual.
    const savedReadings = await saveMeterReadings(db, "copec_tct", parsed.detail, resolveVehicle)
    meterReadings += savedReadings.saved

    const buildRecords = (rows: ParsedConsumptionRow[], batchId: string, worksiteId: string) =>
      rows.map((row) => ({ id: nanoid(), batchId, worksiteId, vehicleId: splitVehicleIds.get(row) ?? resolveVehicle(row.patente, from, to)?.id ?? null, patente: row.patente, numeroTarjetas: row.numeroTarjetas, numeroTransacciones: row.numeroTransacciones, cantidadUnidad: row.cantidadUnidad, monto: row.monto, rendimientoPromedio: row.rendimientoPromedio, precioPromedioUnidad: row.cantidadUnidad > 0 ? Math.round(row.monto / row.cantidadUnidad * 100) / 100 : null, periodoDesde: from, periodoHasta: to, fuente: source, rawRow: row.rawRow }))

    // Las filas de `parsed.errors` son del ARCHIVO completo, no por faena: el
    // loop de abajo crea un lote por cada faena del archivo, y antes le sumaba el
    // conteo COMPLETO a cada uno — con 3 faenas en el mismo reporte, el total de
    // filas rechazadas se triplicaba. Se atribuyen a UNA faena, y en las dos
    // ramas: el flag anterior sólo lo consumía la rama de creación, así que un
    // refresco volvía a multiplicarlas.
    //
    // La faena elegida es la MENOR por id, no la primera del `Map`: el orden de
    // inserción es el orden de filas del Excel, y Copec regenera el archivo en
    // cada descarga, así que un reordenamiento movía las filas inválidas de un
    // lote a otro entre corridas. Ordenar el recorrido completo, además, hace
    // determinista el orden en que se toman los locks por faena.
    const orderedGroups = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
    const errorsWorksiteId = orderedGroups[0]?.[0]
    for (const [worksiteId, rows] of orderedGroups) {
      const fileErrors = worksiteId === errorsWorksiteId ? parsed.errors.length : 0
      // Todo el grupo (dedup por identidad lógica, guard de fuente ajena y el
      // insert que corresponda) bajo un único lock por (faena, período,
      // fuente): antes cada chequeo y cada transacción corrían por separado,
      // así que dos sincronizaciones solapadas (cron + reintento manual, o dos
      // ejecuciones del cron) podían leer "no existe todavía" a la vez y crear
      // el mismo lote dos veces (CO-026). Por hash NO sirve aquí — Copec
      // regenera el Excel en cada descarga.
      const lockKey = `fuel_copec:${worksiteId}:${from}:${to}:${source}`
      const outcome = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`)

        const projectionHash = copecProjectionHash(rows, parsed.errors.length)
        const duplicate = await tx.query.fuelImportBatches.findFirst({ where: and(eq(fuelImportBatches.worksiteId, worksiteId), eq(fuelImportBatches.periodoDesde, from), eq(fuelImportBatches.periodoHasta, to), eq(fuelImportBatches.fuente, source), ne(fuelImportBatches.estado, "revertido")),
          columns: { id: true, hashArchivo: true } })
        if (duplicate) {
          if (duplicate.hashArchivo === projectionHash) return { imported: 0, refreshed: 0 }
          const totals = computeBatchTotals(rows)
          const refresh = await replaceBatchRecords(tx, duplicate.id, buildRecords(rows, duplicate.id, worksiteId))
          await tx.update(fuelImportBatches).set({
            totalFilas: totals.totalFilas + fileErrors,
            filasValidas: totals.totalFilas,
            filasInvalidas: fileErrors,
            totalPatentes: totals.totalPatentes,
            totalTarjetas: totals.totalTarjetas,
            totalTransacciones: totals.totalTransacciones,
            totalCantidad: totals.totalCantidad,
            totalMonto: totals.totalMonto,
            hashArchivo: projectionHash,
            updatedAt: new Date().toISOString(),
          }).where(eq(fuelImportBatches.id, duplicate.id))
          return { imported: refresh.inserted, refreshed: refresh.updated + refresh.removed }
        }
        // El dedup de arriba compara la fuente exacta, así que no ve los lotes
        // importados a mano (fuente 'Copec'): sin este guard, sincronizar un mes ya
        // cargado a mano duplicaría litros y monto de esa faena. Se excluyen TODAS
        // las fuentes automáticas (ver `fuel-sources.ts`): Diésel y BlueMax son lotes
        // separados por diseño y no deben bloquearse entre sí, y un lote de otro
        // proveedor automático en la misma faena y mes es el caso normal —dos
        // contratos de combustible coexistiendo— no una duplicación.
        const foreign = await tx.query.fuelImportBatches.findFirst({
          where: and(
            eq(fuelImportBatches.worksiteId, worksiteId),
            lte(fuelImportBatches.periodoDesde, to),
            gte(fuelImportBatches.periodoHasta, from),
            notInArray(fuelImportBatches.fuente, AUTOMATED_SOURCES),
            ne(fuelImportBatches.estado, "revertido"),
          ),
          columns: { fuente: true },
        })
        if (foreign) return { imported: 0, foreignSource: foreign.fuente }

        const totals = computeBatchTotals(rows)
        const batchId = nanoid()
        await tx.insert(fuelImportBatches).values({ id: batchId, worksiteId, fuente: source, periodoDesde: from, periodoHasta: to, archivoNombre: report.fileName, hashArchivo: projectionHash, estado: "importado", totalFilas: totals.totalFilas + fileErrors, filasValidas: totals.totalFilas, filasInvalidas: fileErrors, totalPatentes: totals.totalPatentes, totalTarjetas: totals.totalTarjetas, totalTransacciones: totals.totalTransacciones, totalCantidad: totals.totalCantidad, totalMonto: totals.totalMonto, importadoPor: resolvedImporterId, notas: "Sincronización mensual automática Copec TCT" })
        await tx.insert(fuelConsumptionRecords).values(buildRecords(rows, batchId, worksiteId))
        return { imported: rows.length }
      })

      if (outcome.foreignSource !== undefined) {
        notes.push(`${productLabel}: faena con importación previa (${outcome.foreignSource}) en el período`)
        cleanupSafe = false
        continue
      }
      imported += outcome.imported
      refreshed += outcome.refreshed ?? 0
      backedBatches.add(providerBatchKey(worksiteId, from, to, source))
    }
    // C1: un mes con filas inválidas NO se certifica `complete`. Queda
    // `incomplete` —con las filas válidas ya proyectadas y las inválidas
    // guardadas— hasta que una persona lo cierre con motivo
    // (`closed_with_issues`). Es la salida que faltaba: antes `failed` no era
    // terminal y el mes bloqueaba el barrido para siempre.
    const tctStatus = isOpenPeriod(to) || !hasEventDetail || mappingsPending || hasInvalidParserRows ? "incomplete" : "complete"
    if (!hasEventDetail) notes.push(`${productLabel}: el archivo no incluye transacciones individuales`)
    if (mappingsPending) notes.push(`${productLabel}: asignación histórica pendiente`)
    const rejectedFileRows = correctionReviewRows.length + (hasInvalidParserRows ? parsed.errors.length : 0)
    const acceptedFileRows = Math.max(0, (eventRows.length > 0 ? eventRows.length - correctionReviewRows.length : parsed.rows.length) - trackedRows.pending)
    await updateCopecFileParseResult({ id: sourceFileId, status: hasInvalidParserRows ? "invalid" : "processed", rowsReceived: sourceRowsReceived, rowsAccepted: acceptedFileRows, rowsRejected: rejectedFileRows, rowsPending: pendingRowsTotal, quantityTotal: parsedQuantity, amountTotal: parsedAmount })
    await recordCopecPeriodCoverage({ channel: "TCT", product, month: monthKey(from), status: tctStatus, sourceAvailability: "available", syncRunId: runId, sourceFileId, rowsReceived: sourceRowsReceived, rowsAccepted: acceptedFileRows, rowsRejected: rejectedFileRows, rowsPending: pendingRowsTotal, quantityTotal: parsedQuantity, amountTotal: parsedAmount, parserVersion })
    if (cleanupSafe) cleanupEligibleSources.add(source)
  }

  // Lotes del período que los informes de esta corrida ya no respaldan: una
  // faena cuyos equipos se movieron, o cargas que Copec retiró del mes. Sin
  // esto conservaban litros y monto para siempre, porque la reconstrucción por
  // hash sólo visita los grupos presentes en el archivo.
  //
  // Sólo las fuentes que produjeron al menos un lote: un producto "no
  // disponible", o uno cuyas patentes quedaron todas sin vehículo, no dice nada
  // sobre lo ya importado y barrerlo borraría datos buenos.
  const unbacked = await emptyUnbackedProviderBatches(db, {
    sources: [...cleanupEligibleSources],
    from,
    to,
    keep: backedBatches,
    lockNamespace: "fuel_copec",
  })
  refreshed += unbacked.records

  const receipts = await importTaeReceiptPeriod(session, from, to, resolvedImporterId, unavailable, notes, runId)
  const { unavailable: _receiptUnavailable, notes: _receiptNotes, ...receiptTotals } = receipts
  return {
    imported,
    refreshed,
    pending: pending.size,
    pendingPlates: [...pending].sort(),
    reports,
    unavailable,
    notes,
    ...receiptTotals,
    rowsReceived: rowsReceived + receipts.rowsReceived,
    rowsAccepted: rowsAccepted + receipts.rowsAccepted,
    rowsRejected: rowsRejected + receipts.rowsRejected,
    // Sin `pending.size`: una patente sin vehículo ya entró al ledger como
    // fila `pending` (`recordFuelProviderValidation` marca así toda fila
    // aceptada sin mapping completo), y el informe TCT trae UNA fila por
    // patente y mes, así que sumar el set contaba exactamente lo mismo dos
    // veces e inflaba `rowsPending` de la corrida.
    rowsPending: rowsPending + receipts.rowsPending,
    meterReadings,
  }
}

/**
 * Canal TAE: misma consulta y mismo mes, otro tipo de tarjeta. Cada fila es una carga
 * de una vasija propia en estación, que es la etapa `received` del ciclo.
 *
 * Sus informes NO se agregan a `reports` a propósito: ese arreglo alimenta el guard
 * que corta el barrido cuando Copec deja de entregar archivos, y debe seguir
 * midiendo únicamente TCT.
 */
async function importTaeReceiptPeriod(
  session: CopecSession,
  from: string,
  to: string,
  importerId: string,
  unavailable: string[],
  notes: string[],
  runId?: string,
): Promise<{ received: number; unmappedCards: string[]; taeReports: number; rowsReceived: number; rowsAccepted: number; rowsRejected: number; rowsPending: number; unavailable: string[]; notes: string[] }> {
  const downloads = await downloadCopecChannel(
    session,
    (["diesel", "bluemax"] as const).map((product) => ({ product, from, to })),
    "TAE",
  )

  let received = 0
  let rowsReceived = 0
  let rowsAccepted = 0
  let rowsRejected = 0
  let rowsPending = 0
  const unmappedCards = new Set<string>()
  let taeReports = 0
  for (const download of downloads) {
    const productLabel = download.product === "diesel" ? "Diesel" : "BlueMax"
    if (download.unavailable) {
      if (await recordDisabledProductAsEmpty({ download, channel: "TAE", from, to, importerId, runId })) continue
      if (isEmptyOpenMonth(download, to)) notes.push(`TAE ${productLabel}: ${EMPTY_OPEN_MONTH_NOTE}`)
      else unavailable.push(`TAE ${productLabel}`)
      await recordCopecPeriodCoverage({ channel: "TAE", product: download.product, month: monthKey(from), status: "unknown", sourceAvailability: "unavailable", syncRunId: runId })
      continue
    }
    if ("failure" in download) {
      unavailable.push(`TAE ${productLabel}: [${download.failure.kind}] ${download.failure.message}`)
      await recordCopecPeriodCoverage({ channel: "TAE", product: download.product, month: monthKey(from), status: "failed", sourceAvailability: "unknown", syncRunId: runId })
      continue
    }
    if (!runId) throw new Error("La evidencia Copec requiere una corrida durable asociada")
    const sourceFileId = await archiveDownloadedCopecReport({ runId, channel: "TAE", product: download.product, from, report: download.report })
    const parseContext = { from, to, expectedProduct: download.product }
    const parsed = parseTaeReceiptRecords(download.report.records, parseContext)
    const parserVersion = COPEC_WS_PARSER_VERSION
    rowsReceived += parsed.rows.length + parsed.errors.length
    const product = download.product
    const accountKey = `tae:${product}`
    const quantityTotal = exactTotal(parsed.rows.map((row) => row.liters), 10_000)
    const amountTotal = exactTotal(parsed.rows.map((row) => row.amount), 100)
    const parserIssues = parsed.errors.map((error) => ({
        input: {
          provider: "copec" as const,
          accountKey,
          sourceRowKey: `${from}:${to}:${product}:error:${error.rowIndex}`,
          externalId: null,
          occurredAt: from,
          sourceDate: from,
          plate: null,
          product,
          quantity: null,
          unitPrice: null,
          amount: null,
          payload: error,
        },
        code: "source_row_invalid",
        message: `${error.field}: ${error.message}`,
      }))
    if (parsed.errors.length > 0 || parsed.rows.length === 0) {
      // Misma regla que TCT (C1): las filas válidas de un informe con errores
      // siguen adelante; el mes queda `incomplete` para cerrarse con evidencia.
      if (parsed.errors.length > 0) {
        rowsRejected += parsed.errors.length
        if (parserIssues.length) await recordFuelProviderIssues(runId, parserIssues)
        notes.push(`TAE ${productLabel}: ${parsed.errors.length} fila(s) inválida(s) del informe, rechazadas y guardadas`)
      }
      if (parsed.rows.length === 0) {
        const rejectedCount = parsed.errors.length || 1
        if (parsed.errors.length === 0) rowsRejected += rejectedCount
        await updateCopecFileParseResult({ id: sourceFileId, status: "invalid", rowsReceived: parsed.rows.length + parsed.errors.length, rowsAccepted: 0, rowsRejected: rejectedCount, quantityTotal, amountTotal })
        await recordCopecPeriodCoverage({ channel: "TAE", product, month: monthKey(from), status: "failed", sourceAvailability: "available", syncRunId: runId, sourceFileId, rowsReceived: parsed.rows.length + parsed.errors.length, rowsAccepted: 0, rowsRejected: rejectedCount, quantityTotal, amountTotal, parserVersion })
        continue
      }
    }

    const eventRows = buildCopecTransactionRows(from, to, product, parsed.rows.map((row) => ({
      rowIndex: row.rowIndex,
      sourceRef: row.documentNumber,
      sourceDate: row.sourceDate,
      occurredAt: row.occurredAt,
      plate: row.cardNumber,
      cardNumber: row.cardNumber,
      product,
      liters: row.liters,
      unitPrice: row.unitPrice,
      amount: row.amount,
      station: row.station,
      rawPayload: row.rawRow,
    })), "TAE")
    const priorEvents = await priorCopecEvents(accountKey, from, to)
    const correctionDecisions = await copecCorrectionDecisions(accountKey, from, to)
    const correctionReviewRows: ProviderRowInput[] = []
    const acceptedEventInputs: ProviderRowInput[] = []
    const correctionIndexes = new Set<number>()
    const supersededEventIds: string[] = []
    for (let index = 0; index < eventRows.length; index++) {
      const row = eventRows[index]!
      const earlierRows = eventRows.slice(0, index).map((previous) => ({ sourceRowKey: previous.sourceRowKey, plate: previous.plate }))
      if (!hasPossibleCopecCorrection(row.sourceRowKey, [...priorEvents, ...earlierRows], row.plate)) {
        acceptedEventInputs.push(row)
        continue
      }
      // C2: igual que en TCT. `resolved` aplica la corrección y reemplaza la
      // recepción previa; `dismissed` la descarta; sin decisión queda en
      // revisión y el mes `incomplete`.
      const decision = correctionDecisions.get(row.sourceRowKey)
      if (decision === "resolved") {
        for (const previous of priorEvents) if (sameGuideOrDay(row.sourceRowKey, previous.sourceRowKey) && previous.sourceRowKey !== row.sourceRowKey) supersededEventIds.push(previous.id)
        acceptedEventInputs.push(row)
        continue
      }
      if (decision === "dismissed") continue
      correctionReviewRows.push({ ...row, sourceRowKey: `${row.sourceRowKey}${CORRECTION_REVIEW_SUFFIX}` })
      correctionIndexes.add(index)
    }
    if (supersededEventIds.length > 0) {
      await markCopecEventsSuperseded(supersededEventIds, { reason: "Corrección de guía TAE aprobada en revisión", actorUserId: importerId, runId })
      notes.push(`TAE ${productLabel}: ${supersededEventIds.length} recepción(es) previa(s) reemplazadas por la corrección aprobada`)
    }
    const eventValidation = validateProviderRows(acceptedEventInputs, { from, to })
    const productIds = [...new Set(acceptedEventInputs.flatMap((input) => {
      const id = fuelProductIdForLegacy(input.product)
      return id ? [id] : []
    }))]
    const locations = productIds.length ? await db.query.fuelStorageLocations.findMany({
      where: and(
        inArray(fuelStorageLocations.productId, productIds),
        isNotNull(fuelStorageLocations.taeCardNumber),
        eq(fuelStorageLocations.isActive, true),
      ),
      columns: { id: true, worksiteId: true, productId: true, taeCardNumber: true },
    }) : []
    // La tarjeta se compara compacta en los dos lados: el validador la entrega
    // como `plateMatchKey` («12422690023091») y la vasija puede guardarla con o
    // sin guiones. Comparándola tal cual, ninguna recepción encontraba su vasija.
    const locationByCardProduct = new Map(locations.map((location) => [`${plateMatchKey(location.taeCardNumber!)}::${location.productId}`, location]))
    const eventPersisted = await recordFuelProviderValidation(runId, eventValidation, (input) => {
      const productId = fuelProductIdForLegacy(input.product)
      const location = productId && input.plate ? locationByCardProduct.get(`${plateMatchKey(input.plate)}::${productId}`) : undefined
      return { worksiteId: location?.worksiteId, storageLocationId: location?.id, productId }
    }, { sourceFileId })
    const correctionsPersisted = correctionReviewRows.length > 0
      ? await recordFuelProviderIssues(runId, correctionReviewRows.map((input) => ({
          input,
          code: "tae_guide_correction_review",
          message: "La guía TAE ya existe con cantidad, fecha u otros datos distintos; se conserva la recepción anterior hasta revisión humana.",
        })))
      : { rejected: 0 }
    rowsRejected += eventPersisted.rejected + (correctionsPersisted.rejected ?? 0)
    rowsPending += eventPersisted.pending
    // `eventRows` se construyó con `map` sobre `parsed.rows`: mismo índice.
    // Una fila que el validador rechazó (cantidad o monto negativo, identidad
    // repetida) no entra al ciclo físico, igual que en TCT no entra al lote.
    const rejectedEventKeys = new Set(eventValidation.rejected.map((issue) => issue.sourceRowKey))
    let outcome
    try {
      const rowsToImport = parsed.rows.filter((_, index) => !correctionIndexes.has(index) && !rejectedEventKeys.has(eventRows[index]!.sourceRowKey))
      outcome = await importTaeReceipts(rowsToImport, importerId)
    } catch (error) {
      // Sin proveedor en el catálogo no hay nada que importar, pero tampoco es
      // una falla de la corrida: se reporta como no disponible para que el
      // cursor TAE no avance y el mes se reintente cuando exista la ficha.
      if (!(error instanceof TaeSupplierMissingError)) throw error
      unavailable.push(`TAE ${productLabel}: ${error.message}`)
      await updateCopecFileParseResult({ id: sourceFileId, status: "processed", rowsReceived: parsed.rows.length, rowsAccepted: parsed.rows.length - correctionReviewRows.length, rowsRejected: correctionReviewRows.length, quantityTotal, amountTotal })
      await recordCopecPeriodCoverage({ channel: "TAE", product, month: monthKey(from), status: "incomplete", sourceAvailability: "available", syncRunId: runId, sourceFileId, rowsReceived: parsed.rows.length, rowsAccepted: parsed.rows.length - correctionReviewRows.length, rowsRejected: correctionReviewRows.length, quantityTotal, amountTotal, parserVersion })
      continue
    }
    // Recién acá: el contador decide si avanza el cursor TAE, así que tiene que
    // significar "este informe entró", no "Copec me lo entregó".
    taeReports++
    received += outcome.inserted
    rowsAccepted += eventPersisted.accepted
    for (const card of outcome.unmappedCards) unmappedCards.add(card)
    const unmappedCardSet = new Set(outcome.unmappedCards)
    const unmappedRows = parsed.rows.filter((row) => unmappedCardSet.has(row.cardNumber))
    if (runId && unmappedRows.length > 0) {
      await recordFuelProviderIssues(runId, unmappedRows.map((row) => ({
        input: {
          provider: "copec" as const,
          accountKey,
          sourceRowKey: row.documentNumber,
          externalId: row.documentNumber,
          occurredAt: row.occurredAt,
          plate: row.cardNumber,
          product,
          quantity: row.liters,
          amount: row.amount,
          payload: row.rawRow,
        },
        code: "unmapped_tae_card",
        message: `La tarjeta TAE ${row.cardNumber} no tiene estanque activo para ${productLabel}`,
      })), "pending")
    }
    const rowsWithValidationErrors = eventValidation.rejected.length > 0
    const coverageStatus = rowsWithValidationErrors || correctionReviewRows.length > 0 || eventPersisted.pending > 0 || isOpenPeriod(to) || parsed.errors.length > 0 ? "incomplete" : "complete"
    const rejectedCount = correctionReviewRows.length + eventValidation.rejected.length + parsed.errors.length + (correctionsPersisted.rejected ?? 0)
    const acceptedCount = parsed.rows.length - correctionReviewRows.length - eventValidation.rejected.length - eventPersisted.pending
    await updateCopecFileParseResult({ id: sourceFileId, status: rowsWithValidationErrors || parsed.errors.length > 0 ? "invalid" : "processed", rowsReceived: parsed.rows.length + parsed.errors.length, rowsAccepted: acceptedCount, rowsRejected: rejectedCount, rowsPending: eventPersisted.pending, quantityTotal, amountTotal })
    await recordCopecPeriodCoverage({ channel: "TAE", product, month: monthKey(from), status: coverageStatus, sourceAvailability: "available", syncRunId: runId, sourceFileId, rowsReceived: parsed.rows.length + parsed.errors.length, rowsAccepted: acceptedCount, rowsRejected: rejectedCount, rowsPending: eventPersisted.pending, quantityTotal, amountTotal, parserVersion })
  }
  return { received, unmappedCards: [...unmappedCards].sort(), taeReports, rowsReceived, rowsAccepted, rowsRejected, rowsPending, unavailable, notes }
}

/**
 * Avance de la revisión histórica pedida a mano.
 *
 * `firstUncoveredMonth` usa `requestedStart` mientras sea anterior al primer
 * mes sin cubrir, así que si nada lo movía el plan quedaba clavado en ese mes:
 * cada corrida reverificaba los mismos 4 meses y nunca seguía. Avanza un mes
 * cuando el mes pedido cierra en los cuatro canales/productos, y se borra en
 * cuanto alcanza al primer mes sin cubrir, donde el plan normal ya retoma.
 * Si el mes pedido no cierra, se queda ahí: ese mes pasó a ser el pendiente.
 */
async function nextRequestedStart(requested: string | null | undefined, period: CopecSyncPeriod, periodTerminal: boolean): Promise<string | null> {
  if (!isValidIsoDate(requested)) return null
  const next = periodTerminal && firstDayOfMonth(requested) === period.from ? nextMonth(period.from) : firstDayOfMonth(requested)
  return next < await firstUncoveredMonth() ? next : null
}

/**
 * `session` es la sesión Copec de la corrida (`withCopecWebServiceSession`).
 * Sin ella se abre una propia para este período.
 */
export async function syncCopecReportPeriod(period: CopecSyncPeriod, importerId?: string, session?: CopecSession): Promise<PeriodSyncResult> {
  if (!session) return withCopecWebServiceSession((session) => syncCopecReportPeriod(period, importerId, session))
  const current = await state()
  // Set NUEVO, no la continuación del guardado. Antes se sembraba con
  // `current.pending` y sólo se hacía `add`: ninguna patente salía nunca, ni
  // siquiera al dar de alta el vehículo. El JSON de estado crecía sin techo y
  // la corrida quedaba `partial` para siempre porque `rowsPending > 0`. El
  // registro durable de lo pendiente es el ledger (`fuel_provider_transactions`
  // con estado `pending`), no esta lista; acá sólo interesa lo de ESTE período.
  const pending = new Set<string>()
  const run = await beginFuelProviderSyncRun({
    provider: "copec",
    trigger: importerId ? "manual" : "cron",
    requestedFrom: period.from,
    requestedTo: period.to,
    actorUserId: importerId,
  })
  let runFinished = false
  let receivedRows = 0
  // Fuera del try: si el período muere después de escribir el ledger, cerrar la
  // corrida con las métricas en cero borraba de la bitácora el trabajo hecho.
  const quality = { accepted: 0, rejected: 0, pending: 0 }
  try {
    const result = await importCopecPeriod(session, period.from, period.to, pending, importerId, run.id, quality)
    receivedRows = result.rowsReceived
    const periodCoverage = await listCopecPeriodCoverage(period.from, period.to)
    const month = monthKey(period.from)
    const terminal = (channel: "TCT" | "TAE", product: "diesel" | "bluemax") => periodCoverage.some((row) =>
      row.channel === channel && row.product === product && row.periodMonth === month && isTerminalCopecCoverage(row.status),
    )
    const tctAdvanced = terminal("TCT", "diesel") && terminal("TCT", "bluemax") && !isOpenPeriod(period.to)
    const taeAdvanced = terminal("TAE", "diesel") && terminal("TAE", "bluemax") && !isOpenPeriod(period.to)
    const requestedStart = await nextRequestedStart(current.requestedStart, period, tctAdvanced && taeAdvanced)
    let stateError: string | null = null
    try {
      // Ningún cursor retrocede: recuperar un mes atrasado hace que el plan
      // vuelva a pedir un período viejo, y guardar su posición tal cual tiraría
      // hacia atrás el canal que ya iba más adelante.
      const forward = (previous: string | null, next: string) => (previous && previous > next ? previous : next)
      await saveState({
        cursor: forward(current.cursor, tctAdvanced ? addDays(period.to, 1) : period.from),
        taeCursor: forward(current.taeCursor, taeAdvanced ? addDays(period.to, 1) : period.from),
        requestedStart,
        lastRunAt: new Date().toISOString(),
        pending: [...pending].sort(),
      }, current._version)
    } catch (err) {
      stateError = err instanceof Error ? err.message : "No fue posible guardar el estado Copec"
      console.error("[copec-sync] saveState failed, cursor may be stale on next run", stateError)
    }
    // La conciliación es un modelo derivado que se calcula DESPUÉS de importar:
    // si falla, los lotes ya están commiteados, así que se reporta como parcial
    // con el motivo en vez de marcar la corrida como fallida.
    const reconciliationError = await reconcileFuelProviderRun(run.id).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : "No fue posible conciliar la corrida"),
    )
    if (reconciliationError) console.error("[copec-sync] conciliación incompleta", reconciliationError)

    await finishFuelProviderSyncRun(run.id, {
      status: stateError || reconciliationError || result.rowsRejected > 0 || result.rowsPending > 0 || result.unavailable.length > 0 ? "partial" : "success",
      receivedFrom: period.from,
      receivedTo: period.to,
      files: result.reports.length + result.taeReports,
      rowsReceived: result.rowsReceived,
      rowsAccepted: result.rowsAccepted,
      rowsRejected: result.rowsRejected,
      rowsPending: result.rowsPending,
      rowsReprocessed: result.refreshed,
      error: stateError ?? reconciliationError ?? (result.unavailable.length ? result.unavailable.join("; ").slice(0, 500) : null),
    })
    runFinished = true
    return result
  } catch (error) {
    if (!runFinished) {
      try {
        await finishFuelProviderSyncRun(run.id, {
          status: "failed",
          receivedFrom: period.from,
          receivedTo: period.to,
          rowsReceived: receivedRows,
          rowsAccepted: quality.accepted,
          rowsRejected: quality.rejected,
          rowsPending: quality.pending,
          error: error instanceof Error ? error.message : "Error desconocido en la sincronización Copec",
        })
      } catch (finishError) {
        console.error("[copec-sync] no fue posible cerrar la corrida durable", finishError instanceof Error ? finishError.message : "error desconocido")
      }
    }
    throw error
  }
}

/**
 * Meses que recorre una corrida, en orden. El mes en curso va PRIMERO aunque el
 * plan no llegue a él. El plan parte del mes sin cobertura más antiguo y se
 * detiene si no lo cierra; con el tope de períodos, un mes histórico atascado
 * dejaba al mes en curso fuera de toda corrida, y los consumos de este mes
 * dejaban de entrar. Refrescarlo no afecta la cobertura: un mes abierto nunca
 * es terminal ni mueve el plan.
 */
export function copecSweepPeriods(planPeriods: CopecSyncPeriod[], todayIso = today()): CopecSyncPeriod[] {
  const openPeriod = buildCopecSyncPeriods(firstDayOfMonth(todayIso), lastDayOfMonth(todayIso))[0]
  return openPeriod && !planPeriods.some((period) => period.from === openPeriod.from)
    ? [openPeriod, ...planPeriods]
    : planPeriods
}

/** Lo que va a recorrer la próxima corrida, para mostrarlo antes de que termine. */
export async function getCopecSweepPeriods(): Promise<CopecSyncPeriod[]> {
  return copecSweepPeriods((await getCopecSyncPlan()).periods)
}

/** Corridas por mes que dejó un barrido iniciado en `since` (o después), en orden. */
export async function listCopecSyncRunsSince(since: string) {
  return db.query.fuelProviderSyncRuns.findMany({
    where: and(eq(fuelProviderSyncRuns.provider, "copec"), gte(fuelProviderSyncRuns.startedAt, since)),
    orderBy: [asc(fuelProviderSyncRuns.startedAt)],
    columns: { requestedFrom: true, requestedTo: true, status: true, rowsReceived: true, rowsAccepted: true, rowsRejected: true, rowsPending: true, error: true },
  })
}

export interface CopecSweepResult {
  /** Primer y último período que la corrida REALMENTE recorrió (no el plan). */
  from: string
  to: string
  imported: number
  refreshed: number
  received: number
  pending: number
  pendingPlates: string[]
  reports: string[]
  /** Copec no entregó el informe de algún canal/producto: la fuente falló. */
  unavailable: string[]
  /** Observaciones que no significan que la fuente falló (filas inválidas, mapeos pendientes). */
  notes: string[]
  /** `unavailable.length`, explícito para el contrato del cron (C6). */
  sourceFailures: number
  /** El presupuesto de tiempo cortó el barrido: quedaron meses sin recorrer (C7). */
  budgetExhausted: boolean
  periodsPlanned: number
  periodsRun: number
  unmappedCards: string[]
  meterReadings: number
}

/**
 * El barrido completo: el mes en curso y los meses pendientes, en UNA sesión
 * Copec. Lo corre el cron y también el botón «Sincronizar» (en segundo
 * plano, ver `startCopecSyncAction`); `importerId` es el operador que lo pidió,
 * y sin él la corrida queda a nombre de `COPEC_SYNC_IMPORTER_EMAIL`.
 */
export async function syncCopecReports(options: { importerId?: string } = {}): Promise<CopecSweepResult> {
  // C7 / 4.7: antes de planificar, se cierran las corridas que quedaron
  // `running` porque la plataforma mató el proceso (el `catch` no corre nunca).
  // Sin esto la pantalla mostraba «sincronizando ahora» para siempre.
  try {
    const closed = await closeStaleFuelProviderSyncRuns({ provider: "copec", olderThanMs: STALE_RUN_MS })
    if (closed > 0) console.warn(`[copec-sync] ${closed} corrida(s) colgada(s) cerradas como fallidas`)
  } catch (error) {
    console.error("[copec-sync] no fue posible cerrar corridas colgadas", error)
  }
  const plan = await getCopecSyncPlan()
  let imported = 0
  let refreshed = 0
  let received = 0
  let meterReadings = 0
  const reports: string[] = []
  const unavailable: string[] = []
  const notes: string[] = []
  const unmappedCards = new Set<string>()
  // Unión de los períodos del barrido, no "el último gana": ahora que cada
  // período parte de un set vacío, quedarse con el conteo del último mes
  // escondía las patentes sin vincular de todos los anteriores.
  const pendingPlates = new Set<string>()
  const periods = copecSweepPeriods(plan.periods)
  // Una sola sesión para todo el barrido: un rechazo de acceso corta lo que
  // queda en vez de repetirse por cada mes (`CopecWsAccessFailure`).
  const budgetDeadline = Date.now() + SWEEP_BUDGET_MS
  return withCopecWebServiceSession(async (session) => {
    const startedAt = Date.now()
    const ran: CopecSyncPeriod[] = []
    let budgetExhausted = false
    for (const [index, period] of periods.entries()) {
      // `maxDuration = 300` en la ruta del cron, y un período puede tomar más de
      // un minuto (hasta cuatro exportaciones por canal). Pasado el
      // presupuesto no se empieza otro: lo que falte lo toma la corrida siguiente.
      // C7: el corte ya no es silencioso — se informa `budgetExhausted` para que
      // el contrato del cron no diga «healthy» de un barrido recortado.
      if (index > 0 && Date.now() - startedAt > SWEEP_BUDGET_MS) { budgetExhausted = true; break }
      const result = await syncCopecReportPeriod(period, options.importerId, session)
      ran.push(period)
      imported += result.imported
      refreshed += result.refreshed
      received += result.received
      meterReadings += result.meterReadings
      for (const card of result.unmappedCards) unmappedCards.add(card)
      for (const plate of result.pendingPlates) pendingPlates.add(plate)
      reports.push(...result.reports)
      unavailable.push(...result.unavailable.map((product) => `${period.from} a ${period.to} (${product})`))
      notes.push(...result.notes.map((note) => `${period.from} a ${period.to} (${note})`))
      // Un mes cerrado que no descargó nada indica servicio/credenciales rotos. Se
      // corta el barrido y se falla ruidosamente en vez de avanzar por todo el
      // histórico importando cero (el bug que dejó la sync "al día" con la tabla
      // vacía); la ausencia sólo se acepta si cada canal/producto ya tiene
      // evidencia terminal (p. ej. legítimamente vacío con operador). El mes en
      // curso puede no estar todavía en el session: no es falla y no corta nada.
      // Si el presupuesto se agotó DURANTE este período, las consultas que no
      // alcanzaron volvieron como falla de red sin abrir conexión: el mes queda
      // a medias por tiempo, no por credenciales. Es un corte (`budgetExhausted`,
      // 503 parcial) que la corrida siguiente retoma, no un barrido roto.
      if (Date.now() >= budgetDeadline) { budgetExhausted = true; break }
      if (!isOpenPeriod(period.to)) {
        const coverage = await listCopecPeriodCoverage(period.from, period.to)
        const month = monthKey(period.from)
        const allDimensionsTerminal = (["TCT", "TAE"] as const).every((channel) => (["diesel", "bluemax"] as const).every((product) =>
          coverage.some((row) => row.channel === channel && row.product === product && row.periodMonth === month && isTerminalCopecCoverage(row.status)),
        ))
        if (!allDimensionsTerminal) {
          if (result.reports.length === 0) throw new Error(`Copec no entregó ningún archivo para el período ${period.from} a ${period.to}. Revisa las credenciales de Copec, o registra evidencia operativa de que el período está vacío. Se importaron ${imported} registros antes de detenerse.`)
          throw new Error(`El período ${period.from} a ${period.to} no alcanzó cobertura terminal para cada canal y producto; se detuvo el barrido antes de saltarlo.`)
        }
      }
    }
    // C10: el resumen dice lo que se recorrió, no lo que el plan pretendía.
    return {
      from: ran[0]?.from ?? plan.from,
      to: ran.at(-1)?.to ?? plan.to,
      imported,
      refreshed,
      received,
      pending: pendingPlates.size,
      pendingPlates: [...pendingPlates].sort(),
      reports,
      unavailable,
      notes,
      sourceFailures: unavailable.length,
      budgetExhausted: budgetExhausted || Date.now() > budgetDeadline,
      periodsPlanned: periods.length,
      periodsRun: ran.length,
      unmappedCards: [...unmappedCards].sort(),
      meterReadings,
    }
  }, { deadline: budgetDeadline })
}

import { createHash } from "node:crypto"
import { and, desc, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords, fuelImportBatches, fuelVehicles, systemSettings, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { parseConsumptionExcel, type ParsedConsumptionRow } from "@/lib/combustibles/consumption-import"
import { computeBatchTotals } from "@/lib/combustibles/consumption-calculations"
import {
  downloadCopecReports,
} from "@/lib/combustibles/copec-reports"

const STATE_KEY = "combustibles.copec.sync"
const START_KEY = "COPEC_SYNC_START_DATE"
const DEFAULT_START = "2020-01-01"
const DEFAULT_MAX_PERIOD_DAYS = 31

const _maxPeriodDays = Number.isInteger(Number(process.env.COPEC_REPORT_MAX_DAYS)) && Number(process.env.COPEC_REPORT_MAX_DAYS) > 0
  ? Number(process.env.COPEC_REPORT_MAX_DAYS)
  : DEFAULT_MAX_PERIOD_DAYS

interface SyncState { cursor: string | null; lastRunAt: string | null; pending: string[]; }

export interface CopecSyncStartOptions {
  currentStart: string
  minimumStart: string
  maximumStart: string
  latestImportedUntil: string | null
}

async function state(): Promise<SyncState & { _version: string }> {
  const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, STATE_KEY) })
  if (!row) return { cursor: null, lastRunAt: null, pending: [], _version: "" }
  try { return { ...{ cursor: null, lastRunAt: null, pending: [], _version: row.updatedAt ?? "" }, ...JSON.parse(row.value) } }
  catch { return { cursor: null, lastRunAt: null, pending: [], _version: "" } }
}

export async function getCopecSyncState(): Promise<{ lastRunAt: string | null; cursor: string | null; pending: number }> {
  const s = await state()
  return { lastRunAt: s.lastRunAt, cursor: s.cursor, pending: s.pending.length }
}

async function saveState(next: SyncState) {
  const value = JSON.stringify(next)
  await db.insert(systemSettings).values({ key: STATE_KEY, value }).onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date().toISOString() } })
}

function yesterday(): string { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }

function today(): string { return new Date().toISOString().slice(0, 10) }

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function isValidIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function startFrom(current: SyncState): string {
  const configuredStart = process.env[START_KEY]?.trim()
  if (isValidIsoDate(current.cursor)) return current.cursor
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

/**
 * The configurable starting point is bounded after every active fuel import,
 * not just Copec batches. This prevents an automatic import from duplicating
 * periods that were already loaded manually.
 */
export async function getCopecSyncStartOptions(): Promise<CopecSyncStartOptions> {
  const [current, latestImportedUntil] = await Promise.all([state(), latestActiveImportUntil()])
  return {
    currentStart: startFrom(current),
    minimumStart: latestImportedUntil ? addDays(latestImportedUntil, 1) : DEFAULT_START,
    maximumStart: today(),
    latestImportedUntil,
  }
}

export async function setCopecSyncStartDate(startDate: string, expectedStart: string): Promise<CopecSyncStartOptions> {
  if (!isValidIsoDate(startDate)) throw new Error("La fecha de inicio no es válida")

  const [current, latestImportedUntil] = await Promise.all([state(), latestActiveImportUntil()])
  if (startFrom(current) !== expectedStart) {
    throw new Error("La sincronización cambió mientras ajustabas la fecha. Actualiza la página e inténtalo nuevamente.")
  }

  const minimumStart = latestImportedUntil ? addDays(latestImportedUntil, 1) : DEFAULT_START
  const maximumStart = today()
  if (startDate < minimumStart) {
    throw new Error(`La fecha debe ser posterior al último período importado (${latestImportedUntil}).`)
  }
  if (startDate > maximumStart) {
    throw new Error("La importación automática solo puede comenzar hasta hoy.")
  }

  await saveState({ cursor: startDate, lastRunAt: current.lastRunAt, pending: current.pending })
  return { currentStart: startDate, minimumStart, maximumStart, latestImportedUntil }
}

function maxPeriodDays(): number {
  return _maxPeriodDays
}

export interface CopecSyncPeriod { from: string; to: string }

/** Divide el histórico en el máximo de días que el portal puede descargar. */
export function buildCopecSyncPeriods(from: string, to: string, maxDays = maxPeriodDays()): CopecSyncPeriod[] {
  if (from > to) return []
  const periods: CopecSyncPeriod[] = []
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, maxDays)) {
    const end = addDays(cursor, maxDays - 1)
    periods.push({ from: cursor, to: end < to ? end : to })
  }
  return periods
}

export async function getCopecSyncPlan(): Promise<{ from: string; to: string; periods: CopecSyncPeriod[]; pending: number }> {
  const current = await state()
  const from = startFrom(current)
  const to = yesterday()
  return { from, to, periods: buildCopecSyncPeriods(from, to), pending: current.pending.length }
}

interface PeriodSyncResult {
  imported: number
  pending: number
  reports: string[]
  unavailable: string[]
}

async function importCopecPeriod(
  from: string,
  to: string,
  pending: Set<string>,
  importerId?: string,
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
  const reports: string[] = []
  const unavailable: string[] = []
  const downloads = await downloadCopecReports(
    (["TCT", "TAE"] as const).map((cardType) => ({ cardType, from, to })),
  )
  for (const download of downloads) {
    const { cardType } = download
    if (download.unavailable) {
      unavailable.push(cardType)
      continue
    }
    const { report } = download
    reports.push(`${cardType}:${report.fileName}`)
    const hash = createHash("sha256").update(report.buffer).digest("hex")
    const parsed = await parseConsumptionExcel(report.buffer)
    const plates = [...new Set(parsed.rows.map((row) => row.patente))]
    const vehicles = plates.length ? await db.query.fuelVehicles.findMany({ where: inArray(fuelVehicles.plate, plates), columns: { id: true, plate: true, worksiteId: true } }) : []
    const byPlate = new Map(vehicles.map((vehicle) => [vehicle.plate, vehicle]))
    const groups = new Map<string, ParsedConsumptionRow[]>()
    for (const row of parsed.rows) {
      const vehicle = byPlate.get(row.patente)
      if (!vehicle) { pending.add(row.patente); continue }
      const rows = groups.get(vehicle.worksiteId) ?? []
      rows.push(row); groups.set(vehicle.worksiteId, rows)
    }
    for (const [worksiteId, rows] of groups) {
      const duplicate = await db.query.fuelImportBatches.findFirst({ where: and(eq(fuelImportBatches.hashArchivo, hash), eq(fuelImportBatches.worksiteId, worksiteId), ne(fuelImportBatches.estado, "revertido")) })
      if (duplicate) continue
      const totals = computeBatchTotals(rows)
      const batchId = nanoid()
      await db.transaction(async (tx) => {
        await tx.insert(fuelImportBatches).values({ id: batchId, worksiteId, fuente: `Copec ${cardType}`, periodoDesde: from, periodoHasta: to, archivoNombre: report.fileName, hashArchivo: hash, estado: "importado", totalFilas: totals.totalFilas + parsed.errors.length, filasValidas: totals.totalFilas, filasInvalidas: parsed.errors.length, totalPatentes: totals.totalPatentes, totalTarjetas: totals.totalTarjetas, totalTransacciones: totals.totalTransacciones, totalCantidad: totals.totalCantidad, totalMonto: totals.totalMonto, importadoPor: resolvedImporterId, notas: "Sincronización automática Copec" })
        await tx.insert(fuelConsumptionRecords).values(rows.map((row) => ({ id: nanoid(), batchId, worksiteId, vehicleId: byPlate.get(row.patente)?.id ?? null, patente: row.patente, numeroTarjetas: row.numeroTarjetas, numeroTransacciones: row.numeroTransacciones, cantidadUnidad: row.cantidadUnidad, monto: row.monto, rendimientoPromedio: row.rendimientoPromedio, precioPromedioUnidad: row.cantidadUnidad > 0 ? Math.round(row.monto / row.cantidadUnidad * 100) / 100 : null, periodoDesde: from, periodoHasta: to, fuente: `Copec ${cardType}`, rawRow: row.rawRow })))
      })
      imported += rows.length
    }
  }
  return { imported, pending: pending.size, reports, unavailable }
}

export async function syncCopecReportPeriod(period: CopecSyncPeriod, importerId?: string): Promise<PeriodSyncResult> {
  const current = await state()
  const pending = new Set(current.pending)
  const result = await importCopecPeriod(period.from, period.to, pending, importerId)
  // Persistimos cada período. Así una primera importación extensa puede
  // reanudarse y no vuelve a descargar los tramos ya procesados.
  // Si saveState falla, los datos ya están insertados con hash check;
  // la próxima ejecución re-procesará el período pero el hash check
  // evitará duplicados.
  try {
    await saveState({ cursor: addDays(period.to, 1), lastRunAt: new Date().toISOString(), pending: [...pending].sort() })
  } catch (err) {
    console.error("[copec-sync] saveState failed, cursor may be stale on next run", err)
  }
  return result
}

export async function syncCopecReports(): Promise<{ from: string; to: string; imported: number; pending: number; reports: string[]; unavailable: string[] }> {
  const plan = await getCopecSyncPlan()
  let imported = 0
  const reports: string[] = []
  const unavailable: string[] = []
  let pending = plan.pending
  for (const period of plan.periods) {
    const result = await syncCopecReportPeriod(period)
    imported += result.imported
    pending = result.pending
    reports.push(...result.reports)
    unavailable.push(...result.unavailable.map((cardType) => `${period.from} a ${period.to} (${cardType})`))
  }
  return { from: plan.from, to: plan.to, imported, pending, reports, unavailable }
}

import { createHash } from "node:crypto"
import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords, fuelImportBatches, fuelVehicles, systemSettings, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { parseConsumptionExcel, type ParsedConsumptionRow } from "@/lib/combustibles/consumption-import"
import { computeBatchTotals } from "@/lib/combustibles/consumption-calculations"
import {
  downloadCopecReport,
  isCopecReportUnavailableError,
} from "@/lib/combustibles/copec-reports"

const STATE_KEY = "combustibles.copec.sync"
const START_KEY = "COPEC_SYNC_START_DATE"
const DEFAULT_START = "2020-01-01"
const DEFAULT_MAX_PERIOD_DAYS = 31

const _maxPeriodDays = Number.isInteger(Number(process.env.COPEC_REPORT_MAX_DAYS)) && Number(process.env.COPEC_REPORT_MAX_DAYS) > 0
  ? Number(process.env.COPEC_REPORT_MAX_DAYS)
  : DEFAULT_MAX_PERIOD_DAYS

interface SyncState { cursor: string | null; lastRunAt: string | null; pending: string[]; }

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

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
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
  const from = current.cursor ?? process.env[START_KEY]?.trim() ?? DEFAULT_START
  const to = yesterday()
  return { from, to, periods: buildCopecSyncPeriods(from, to), pending: current.pending.length }
}

interface PeriodSyncResult {
  imported: number
  pending: number
  reports: string[]
  unavailable: string[]
}

async function importCopecPeriod(from: string, to: string, pending: Set<string>): Promise<PeriodSyncResult> {
  const importerEmail = process.env.COPEC_SYNC_IMPORTER_EMAIL?.trim()
  const importer = importerEmail
    ? await db.query.users.findFirst({ where: and(eq(users.email, importerEmail), eq(users.isActive, true)), columns: { id: true } })
    : null
  if (!importer) throw new Error("No hay un usuario activo para registrar la sincronización Copec")

  let imported = 0
  const reports: string[] = []
  const unavailable: string[] = []
  for (const cardType of ["TCT", "TAE"] as const) {
    let report
    try {
      report = await downloadCopecReport({ cardType, from, to })
    } catch (error) {
      if (isCopecReportUnavailableError(error)) {
        unavailable.push(cardType)
        continue
      }
      throw error
    }
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
        await tx.insert(fuelImportBatches).values({ id: batchId, worksiteId, fuente: `Copec ${cardType}`, periodoDesde: from, periodoHasta: to, archivoNombre: report.fileName, hashArchivo: hash, estado: "importado", totalFilas: totals.totalFilas + parsed.errors.length, filasValidas: totals.totalFilas, filasInvalidas: parsed.errors.length, totalPatentes: totals.totalPatentes, totalTarjetas: totals.totalTarjetas, totalTransacciones: totals.totalTransacciones, totalCantidad: totals.totalCantidad, totalMonto: totals.totalMonto, importadoPor: importer.id, notas: "Sincronización automática Copec" })
        await tx.insert(fuelConsumptionRecords).values(rows.map((row) => ({ id: nanoid(), batchId, worksiteId, vehicleId: byPlate.get(row.patente)?.id ?? null, patente: row.patente, numeroTarjetas: row.numeroTarjetas, numeroTransacciones: row.numeroTransacciones, cantidadUnidad: row.cantidadUnidad, monto: row.monto, rendimientoPromedio: row.rendimientoPromedio, precioPromedioUnidad: row.cantidadUnidad > 0 ? Math.round(row.monto / row.cantidadUnidad * 100) / 100 : null, periodoDesde: from, periodoHasta: to, fuente: `Copec ${cardType}`, rawRow: row.rawRow })))
      })
      imported += rows.length
    }
  }
  return { imported, pending: pending.size, reports, unavailable }
}

export async function syncCopecReportPeriod(period: CopecSyncPeriod): Promise<PeriodSyncResult> {
  const current = await state()
  const pending = new Set(current.pending)
  const result = await importCopecPeriod(period.from, period.to, pending)
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

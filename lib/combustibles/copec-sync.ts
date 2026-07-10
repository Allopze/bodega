import { createHash } from "node:crypto"
import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords, fuelImportBatches, fuelVehicles, systemSettings, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { parseConsumptionExcel, type ParsedConsumptionRow } from "@/lib/combustibles/consumption-import"
import { computeBatchTotals } from "@/lib/combustibles/consumption-calculations"
import { downloadCopecReport } from "@/lib/combustibles/copec-reports"

const STATE_KEY = "combustibles.copec.sync"
const START_KEY = "COPEC_SYNC_START_DATE"
const DEFAULT_START = "2020-01-01"

interface SyncState { cursor: string | null; lastRunAt: string | null; pending: string[]; }

async function state(): Promise<SyncState> {
  const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, STATE_KEY) })
  if (!row) return { cursor: null, lastRunAt: null, pending: [] }
  try { return { ...{ cursor: null, lastRunAt: null, pending: [] }, ...JSON.parse(row.value) } }
  catch { return { cursor: null, lastRunAt: null, pending: [] } }
}

async function saveState(next: SyncState) {
  const value = JSON.stringify(next)
  await db.insert(systemSettings).values({ key: STATE_KEY, value }).onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date().toISOString() } })
}

function yesterday(): string { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }

export async function syncCopecReports(): Promise<{ from: string; to: string; imported: number; pending: number; reports: string[] }> {
  const current = await state()
  const from = current.cursor ?? process.env[START_KEY]?.trim() ?? DEFAULT_START
  const to = yesterday()
  if (from > to) return { from, to, imported: 0, pending: current.pending.length, reports: [] }
  const importer = await db.query.users.findFirst({ where: eq(users.isActive, true), columns: { id: true } })
  if (!importer) throw new Error("No hay un usuario activo para registrar la sincronización Copec")

  let imported = 0
  const pending = new Set(current.pending)
  const reports: string[] = []
  for (const cardType of ["TCT", "TAE"] as const) {
    const report = await downloadCopecReport({ cardType, from, to })
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
  await saveState({ cursor: to, lastRunAt: new Date().toISOString(), pending: [...pending].sort() })
  return { from, to, imported, pending: pending.size, reports }
}

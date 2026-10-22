/**
 * scripts/backfill-fuel-equipment-loads.ts
 *
 * Proyecta a `fuel_equipment_loads` (serie canónica del control de combustible)
 * las cargas en terreno/TAE y los registros del log operacional que todavía no
 * tienen proyección, y recalcula la serie de cada equipo tocado.
 *
 *   npm run db:backfill-fuel-equipment-loads
 *   FUEL_LOADS_BACKFILL_DRY_RUN=true npm run db:backfill-fuel-equipment-loads
 *
 * Corre en cada despliegue (al final de `db:migrate`), así que tiene que ser
 * barato cuando no hay nada que hacer: solo lee los orígenes SIN carga
 * proyectada (anti-join) y, si no hay ninguno, termina sin escribir.
 * Idempotente: la proyección es un upsert por origen, reejecutar no duplica.
 *
 * Una transacción por equipo: si uno falla, los anteriores quedan hechos y el
 * reintento los salta. Los registros que no se pueden proyectar (sin faena o
 * con 0 L) no se leen: la consulta ya los excluye, y no se intentan cada vez.
 * El log solo trae conteos, nunca datos de las cargas.
 */
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentLoads, fuelOperationRecords, fuelTaeSubmissions } from "@/db/schema"
import { readOperationFacts, readTaeFacts } from "@/lib/combustibles/control/projection-sources"
import { upsertProjectedLoads } from "@/lib/combustibles/control/projection-upsert"
import { recomputeVehicleSeries } from "@/lib/combustibles/control/projection-series"
import { loadPerformanceControlContext } from "@/lib/combustibles/control/settings"

const DRY_RUN = process.env.FUEL_LOADS_BACKFILL_DRY_RUN === "true"
const CHUNK = 1000

class DryRunRollback extends Error {
  constructor(readonly counts: { projected: number; skipped: number }) {
    super("dry-run")
  }
}

interface Group { tae: string[]; ops: string[] }

export interface FuelLoadsBackfillReport {
  modo: "ensayo (sin escribir)" | "aplicado"
  pendientesTerreno: number
  pendientesLog: number
  equipos: number
  sinEquipo: number
  proyectadas: number
  omitidas: number
}

const chunks = <T>(items: T[]) => Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) => items.slice(i * CHUNK, (i + 1) * CHUNK))

async function projectGroup(vehicleId: string | null, group: Group, context: Awaited<ReturnType<typeof loadPerformanceControlContext>>) {
  try {
    return await db.transaction(async (tx) => {
      let projected = 0
      let skipped = 0
      for (const ids of chunks(group.tae)) {
        projected += (await upsertProjectedLoads(tx, await readTaeFacts(tx, ids), "taeSubmissionId")).projected
      }
      for (const ids of chunks(group.ops)) {
        const read = await readOperationFacts(tx, ids)
        skipped += read.skipped.length
        projected += (await upsertProjectedLoads(tx, read.facts, "operationRecordId")).projected
      }
      if (vehicleId) await recomputeVehicleSeries(tx, vehicleId, context)
      if (DRY_RUN) throw new DryRunRollback({ projected, skipped })
      return { projected, skipped }
    })
  } catch (error) {
    if (error instanceof DryRunRollback) return error.counts
    throw error
  }
}

export async function backfillFuelEquipmentLoads(): Promise<FuelLoadsBackfillReport> {
  const [tae, ops] = await Promise.all([
    db.select({ id: fuelTaeSubmissions.id, vehicleId: fuelTaeSubmissions.vehicleId })
      .from(fuelTaeSubmissions)
      .leftJoin(fuelEquipmentLoads, eq(fuelEquipmentLoads.taeSubmissionId, fuelTaeSubmissions.id))
      .where(isNull(fuelEquipmentLoads.id)),
    db.select({ id: fuelOperationRecords.id, vehicleId: fuelOperationRecords.vehicleId })
      .from(fuelOperationRecords)
      .leftJoin(fuelEquipmentLoads, eq(fuelEquipmentLoads.operationRecordId, fuelOperationRecords.id))
      .where(and(isNull(fuelEquipmentLoads.id), isNotNull(fuelOperationRecords.worksiteId), gt(fuelOperationRecords.liters, 0))),
  ])

  const groups = new Map<string | null, Group>()
  const groupOf = (vehicleId: string | null) => {
    let group = groups.get(vehicleId)
    if (!group) { group = { tae: [], ops: [] }; groups.set(vehicleId, group) }
    return group
  }
  for (const row of tae) groupOf(row.vehicleId).tae.push(row.id)
  for (const row of ops) groupOf(row.vehicleId).ops.push(row.id)

  const report: FuelLoadsBackfillReport = {
    modo: DRY_RUN ? "ensayo (sin escribir)" : "aplicado",
    pendientesTerreno: tae.length,
    pendientesLog: ops.length,
    equipos: [...groups.keys()].filter((key) => key !== null).length,
    sinEquipo: (groups.get(null)?.tae.length ?? 0) + (groups.get(null)?.ops.length ?? 0),
    proyectadas: 0,
    omitidas: 0,
  }
  if (groups.size === 0) return report

  const context = await loadPerformanceControlContext(db)
  for (const [vehicleId, group] of groups) {
    const counts = await projectGroup(vehicleId, group, context)
    report.proyectadas += counts.projected
    report.omitidas += counts.skipped
  }
  return report
}

async function main() {
  const report = await backfillFuelEquipmentLoads()
  console.log(JSON.stringify(report, null, 2))
}

const invokedPath = process.argv[1]
const isDirectInvocation = invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)

if (isDirectInvocation) {
  main().then(
    () => process.exit(0),
    (error) => {
      // Sin los parámetros de la consulta: traerían datos de las cargas (nombres, lecturas).
      console.error(error instanceof Error ? error.message.split("\nparams:")[0] : "Error desconocido")
      process.exit(1)
    },
  )
}

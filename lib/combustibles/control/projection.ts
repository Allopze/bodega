import { eq, inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import { fuelEquipmentLoads, fuelOperationRecords } from "@/db/schema"
import { readOperationFacts, readTaeFacts, type SkippedRecord } from "./projection-sources"
import { upsertProjectedLoads, voidSkippedProjections } from "./projection-upsert"
import { recomputeVehicles } from "./projection-series"

/**
 * Proyección de los orígenes (cargas en terreno/TAE y log operacional) a la
 * serie canónica `fuel_equipment_loads`, y recálculo de la serie de cada equipo
 * afectado. Idempotente: proyectar dos veces deja las mismas filas.
 *
 * Si cambian los hechos de una carga con decisión humana (litros, lectura,
 * instante o equipo), la decisión vuelve a `ok` y la carga se reevalúa;
 * `resetLoadIds` lista esas cargas para que el llamador lo audite.
 */

export { recomputeVehicleSeries } from "./projection-series"

export async function projectTaeSubmissions(
  tx: Tx,
  submissionIds: string[],
): Promise<{ projected: number; vehicleIds: string[]; resetLoadIds: string[] }> {
  const ids = [...new Set(submissionIds)]
  const facts = await readTaeFacts(tx, ids)
  const outcome = await upsertProjectedLoads(tx, facts, "taeSubmissionId")
  await recomputeVehicles(tx, outcome.vehicleIds)
  return outcome
}

export async function projectOperationRecords(
  tx: Tx,
  recordIds: string[],
): Promise<{ projected: number; skipped: SkippedRecord[]; vehicleIds: string[]; resetLoadIds: string[] }> {
  const ids = [...new Set(recordIds)]
  const { facts, skipped } = await readOperationFacts(tx, ids)
  const outcome = await upsertProjectedLoads(tx, facts, "operationRecordId")
  const voidedVehicles = await voidSkippedProjections(tx, skipped)
  const vehicleIds = [...new Set([...outcome.vehicleIds, ...voidedVehicles])]
  await recomputeVehicles(tx, vehicleIds)
  return { projected: outcome.projected, skipped, vehicleIds, resetLoadIds: outcome.resetLoadIds }
}

/**
 * Al revertir un lote del log operacional. Debe llamarse ANTES de borrar los
 * registros del lote: el borrado en cascada elimina las cargas, pero no sabe
 * recalcular las series de los equipos que quedan con un hueco.
 */
export async function removeProjectionsForOperationBatch(tx: Tx, batchId: string): Promise<void> {
  const rows = await tx.select({ id: fuelEquipmentLoads.id, vehicleId: fuelEquipmentLoads.vehicleId })
    .from(fuelEquipmentLoads)
    .innerJoin(fuelOperationRecords, eq(fuelOperationRecords.id, fuelEquipmentLoads.operationRecordId))
    .where(eq(fuelOperationRecords.batchId, batchId))
  if (rows.length === 0) return
  const ids = rows.map((row) => row.id)
  for (let i = 0; i < ids.length; i += 1000) {
    await tx.delete(fuelEquipmentLoads).where(inArray(fuelEquipmentLoads.id, ids.slice(i, i + 1000)))
  }
  await recomputeVehicles(tx, rows.flatMap((row) => (row.vehicleId ? [row.vehicleId] : [])))
}

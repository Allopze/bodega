/**
 * Soporte para importar un período que todavía no cerró.
 *
 * `fuel_import_batches` + `fuel_consumption_records` guardan un AGREGADO por
 * (faena, período, producto, patente). Mientras el período está abierto ese
 * agregado cambia con cada carga nueva, así que reimportarlo no puede limitarse
 * a "agregar las patentes que faltaban": hay que actualizar las que ya están.
 *
 * Lo que NO se hace es borrar y reinsertar, aunque sería más corto: al borrar se
 * pierde el `vehicle_id` que un operador haya fijado a mano con
 * `linkConsumptionPlateAction`, donde puede elegir un vehículo cuya patente no
 * coincide con la del reporte. Ese vínculo no existe en ninguna otra parte y
 * recalcularlo desde el catálogo lo borraría en silencio.
 */

import { and, eq, notInArray } from "drizzle-orm"
import { type DB } from "@/db"
import { fuelConsumptionRecords } from "@/db/schema"
import { todayInChile } from "@/lib/utils"
import { type BatchTotals } from "@/lib/combustibles/consumption-calculations"

type RecordsTx = Pick<DB, "insert" | "update" | "delete" | "query">

export type ConsumptionRecordInsert = typeof fuelConsumptionRecords.$inferInsert

/**
 * Un período está abierto mientras su último día no haya pasado.
 *
 * El día final cuenta como abierto: una carga puede entrar hoy mismo. El período
 * cierra recién cuando `periodoHasta` queda estrictamente en el pasado.
 */
export function isOpenPeriod(periodoHasta: string, today: string = todayInChile()): boolean {
  return periodoHasta >= today
}

/**
 * Deja los registros del lote al día: actualiza las patentes que ya estaban e
 * inserta las nuevas. No borra ninguna.
 *
 * Se preserva el `vehicleId` guardado cuando ya tiene valor (ver el docblock del
 * módulo). Si está en `null` sí se toma el recalculado: es el caso de la patente
 * que quedó sin vincular y cuyo vehículo se dio de alta después.
 */
export async function upsertBatchRecords(
  tx: RecordsTx,
  batchId: string,
  records: ConsumptionRecordInsert[],
): Promise<{ inserted: number; updated: number }> {
  const existing = await tx.query.fuelConsumptionRecords.findMany({
    where: eq(fuelConsumptionRecords.batchId, batchId),
    columns: { id: true, patente: true, vehicleId: true },
  })
  const stored = new Map(existing.map((record) => [record.patente, record]))
  const updatedAt = new Date().toISOString()

  const toInsert: ConsumptionRecordInsert[] = []
  let updated = 0
  for (const record of records) {
    const previous = stored.get(record.patente)
    if (!previous) {
      toInsert.push(record)
      continue
    }
    await tx.update(fuelConsumptionRecords)
      .set({
        numeroTarjetas: record.numeroTarjetas,
        numeroTransacciones: record.numeroTransacciones,
        cantidadUnidad: record.cantidadUnidad,
        monto: record.monto,
        rendimientoPromedio: record.rendimientoPromedio,
        precioPromedioUnidad: record.precioPromedioUnidad,
        rawRow: record.rawRow,
        ...(previous.vehicleId ? {} : { vehicleId: record.vehicleId }),
        updatedAt,
      })
      .where(eq(fuelConsumptionRecords.id, previous.id))
    updated++
  }
  if (toInsert.length > 0) await tx.insert(fuelConsumptionRecords).values(toInsert)
  return { inserted: toInsert.length, updated }
}

/**
 * Rebuilds the aggregate from the validated provider ledger. A source refresh
 * is a replacement, not an additive import: absent plates are removed from the
 * projection while any manual mapping is expected to live in
 * `fuel_provider_mappings`, outside this table.
 */
export async function replaceBatchRecords(
  tx: RecordsTx,
  batchId: string,
  records: ConsumptionRecordInsert[],
): Promise<{ inserted: number; updated: number; removed: number }> {
  const existing = await tx.query.fuelConsumptionRecords.findMany({
    where: eq(fuelConsumptionRecords.batchId, batchId),
    columns: { id: true, patente: true, vehicleId: true },
  })
  const incomingPlates = [...new Set(records.map((record) => record.patente))]
  const incomingPlateSet = new Set(incomingPlates)
  const removed = existing.filter((record) => !incomingPlateSet.has(record.patente)).length
  await tx.delete(fuelConsumptionRecords).where(
    incomingPlates.length === 0
      ? eq(fuelConsumptionRecords.batchId, batchId)
      : and(eq(fuelConsumptionRecords.batchId, batchId), notInArray(fuelConsumptionRecords.patente, incomingPlates)),
  )

  const stored = new Map(existing.map((record) => [record.patente, record]))
  const updatedAt = new Date().toISOString()
  const toInsert: ConsumptionRecordInsert[] = []
  let updated = 0
  for (const record of records) {
    const previous = stored.get(record.patente)
    if (!previous) {
      toInsert.push(record)
      continue
    }
    await tx.update(fuelConsumptionRecords)
      .set({
        numeroTarjetas: record.numeroTarjetas,
        numeroTransacciones: record.numeroTransacciones,
        cantidadUnidad: record.cantidadUnidad,
        monto: record.monto,
        rendimientoPromedio: record.rendimientoPromedio,
        precioPromedioUnidad: record.precioPromedioUnidad,
        rawRow: record.rawRow,
        ...(previous.vehicleId ? {} : { vehicleId: record.vehicleId }),
        updatedAt,
      })
      .where(eq(fuelConsumptionRecords.id, previous.id))
    updated++
  }
  if (toInsert.length > 0) await tx.insert(fuelConsumptionRecords).values(toInsert)
  return { inserted: toInsert.length, updated, removed }
}

/** Los totales de un lote tal como quedaron guardados. */
export interface StoredBatchTotals {
  totalFilas: number
  totalPatentes: number
  totalTarjetas: number
  totalTransacciones: number
  totalCantidad: number
  totalMonto: number
}

/**
 * True cuando el agregado guardado ya es idéntico al recién calculado.
 *
 * Evita reescribir el lote del mes en curso en cada corrida cuando no llegó
 * ninguna carga nueva: sin esto, un mes abierto deja `updated_at` nuevo en todos
 * sus registros todos los días, lo que ensucia la auditoría y hace ruido en
 * cualquier vista ordenada por última modificación.
 *
 * Las columnas son `numeric` con la misma escala a la que redondea
 * `computeBatchTotals` (4 para litros, 2 para monto), así que la comparación
 * exacta es fiable y no hace falta epsilon.
 */
export function batchTotalsUnchanged(stored: StoredBatchTotals, computed: BatchTotals): boolean {
  return stored.totalFilas === computed.totalFilas
    && stored.totalPatentes === computed.totalPatentes
    && stored.totalTarjetas === computed.totalTarjetas
    && stored.totalTransacciones === computed.totalTransacciones
    && stored.totalCantidad === computed.totalCantidad
    && stored.totalMonto === computed.totalMonto
}

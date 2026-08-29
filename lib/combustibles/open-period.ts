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
 *
 * Por eso la fila se identifica por `plateMatchKey` y no por el texto exacto de
 * la patente: cada fuente trae su propio formato ("SZ GB 72" en Aramco, "SZGB72"
 * en Copec) y un cambio de formato hacía que la fila guardada no calzara con la
 * entrante — se borraba y se reinsertaba, que es exactamente lo que este módulo
 * existe para evitar. El `UPDATE` incluye `patente` para que el texto guardado
 * se alinee solo con el canon en el refresco siguiente.
 */

import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm"
import { type DB } from "@/db"
import { fuelConsumptionRecords, fuelImportBatches } from "@/db/schema"
import { todayInChile } from "@/lib/utils"
import { type BatchTotals } from "@/lib/combustibles/consumption-calculations"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"

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
  const stored = new Map(existing.map((record) => [plateMatchKey(record.patente), record]))
  const updatedAt = new Date().toISOString()

  const toInsert: ConsumptionRecordInsert[] = []
  let updated = 0
  for (const record of records) {
    const previous = stored.get(plateMatchKey(record.patente))
    if (!previous) {
      toInsert.push(record)
      continue
    }
    await tx.update(fuelConsumptionRecords)
      .set({
        patente: record.patente,
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
  // El borrado va por `id` y ya no por exclusión de patentes en SQL: las filas
  // están en memoria, y comparar el texto de la patente volvería a depender del
  // formato exacto que este módulo dejó de usar como identidad.
  const incomingPlateKeys = new Set(records.map((record) => plateMatchKey(record.patente)))
  const obsolete = existing.filter((record) => !incomingPlateKeys.has(plateMatchKey(record.patente)))
  const removed = obsolete.length
  if (removed > 0) {
    await tx.delete(fuelConsumptionRecords).where(and(
      eq(fuelConsumptionRecords.batchId, batchId),
      inArray(fuelConsumptionRecords.id, obsolete.map((record) => record.id)),
    ))
  }

  const stored = new Map(existing.map((record) => [plateMatchKey(record.patente), record]))
  const updatedAt = new Date().toISOString()
  const toInsert: ConsumptionRecordInsert[] = []
  let updated = 0
  for (const record of records) {
    const previous = stored.get(plateMatchKey(record.patente))
    if (!previous) {
      toInsert.push(record)
      continue
    }
    await tx.update(fuelConsumptionRecords)
      .set({
        patente: record.patente,
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


/* ── Lotes que la fuente dejó de respaldar ───────────────────────────────── */

/** Clave de un lote de proveedor: (faena, período, fuente). */
export function providerBatchKey(worksiteId: string, from: string, to: string, source: string): string {
  return `${worksiteId}|${from}|${to}|${source}`
}

/**
 * Vacía los lotes de la ventana sincronizada que la fuente ya NO respalda.
 *
 * La reconstrucción por hash sólo alcanza a los `(faena, período, fuente)` que
 * APARECEN en la respuesta del proveedor. Un grupo que desaparece —un vehículo
 * que cambia de faena, o un mes cuyas cargas el proveedor retiró— no se visita
 * nunca, así que su lote conservaba litros y monto para siempre, sumando a los
 * totales de una faena que ya no los tuvo.
 *
 * Se VACÍA, no se borra ni se marca `revertido`: `revertido` es un acto humano
 * con significado propio (alguien deshizo una importación), y borrar el lote
 * perdería la evidencia de que ese período sí se sincronizó. Un lote en cero es
 * la lectura honesta: "acá no quedó consumo".
 *
 * El llamador es responsable de NO invocarla cuando la respuesta del proveedor
 * fue parcial o vacía: vaciar contra una descarga incompleta borraría datos
 * buenos. Por eso recibe explícitamente las fuentes que sí se pudieron leer.
 */
export async function emptyUnbackedProviderBatches(
  db: Pick<DB, "query" | "transaction">,
  params: {
    /** Sólo las fuentes cuya descarga se leyó completa en esta corrida. */
    sources: string[]
    from: string
    to: string
    /** Claves de `providerBatchKey` que la respuesta sí respalda. */
    keep: Set<string>
    /** Prefijo del lock por lote, para no cruzarse con el insert/refresh. */
    lockNamespace: string
  },
): Promise<{ emptied: number; records: number }> {
  if (params.sources.length === 0) return { emptied: 0, records: 0 }

  const candidates = await db.query.fuelImportBatches.findMany({
    where: and(
      inArray(fuelImportBatches.fuente, params.sources),
      gte(fuelImportBatches.periodoDesde, params.from),
      lte(fuelImportBatches.periodoHasta, params.to),
      ne(fuelImportBatches.estado, "revertido"),
    ),
    columns: { id: true, worksiteId: true, periodoDesde: true, periodoHasta: true, fuente: true, totalFilas: true },
  })

  let emptied = 0
  let records = 0
  for (const batch of candidates) {
    const key = providerBatchKey(batch.worksiteId, batch.periodoDesde, batch.periodoHasta, batch.fuente)
    if (params.keep.has(key)) continue
    if (batch.totalFilas === 0) continue

    const lockKey = `${params.lockNamespace}:${batch.worksiteId}:${batch.periodoDesde}:${batch.periodoHasta}:${batch.fuente}`
    const removed = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`)
      const replacement = await replaceBatchRecords(tx, batch.id, [])
      await tx.update(fuelImportBatches).set({
        totalFilas: 0,
        filasValidas: 0,
        filasInvalidas: 0,
        totalPatentes: 0,
        totalTarjetas: 0,
        totalTransacciones: 0,
        totalCantidad: 0,
        totalMonto: 0,
        // El hash deja de describir un contenido: se anula para que la corrida
        // siguiente reconstruya el lote si la fuente vuelve a respaldarlo.
        hashArchivo: "",
        updatedAt: new Date().toISOString(),
      }).where(eq(fuelImportBatches.id, batch.id))
      return replacement.removed
    })
    if (removed > 0 || batch.totalFilas > 0) emptied++
    records += removed
  }
  return { emptied, records }
}

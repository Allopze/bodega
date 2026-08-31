/**
 * Reconstruye `fuel_meter_readings` desde el detalle que ya está guardado.
 *
 * Los informes de Copec y las transacciones de Aramco se persisten enteros en
 * `fuel_consumption_records.raw_row->'detalle'` desde siempre: el odómetro, la
 * hora y la estación de servicio llevan años entrando y quedándose ahí sin que
 * nadie los lea. Este script los rescata SIN volver a salir al portal — no hay
 * login, ni navegador, ni cuota de proveedor que gastar.
 *
 * Idempotente: la identidad de una lectura es (fuente, guía de despacho) para
 * Copec y (fuente, transactionId) para Aramco, así que repetirlo sobre una base
 * al día no cambia ninguna fila.
 *
 * El vehículo se toma del que ya tiene resuelto la fila de consumo —ahí vive la
 * decisión manual de `linkConsumptionPlateAction`, que el match por patente
 * desharía— y sólo se cae al catálogo cuando la fila quedó sin vincular. Una
 * patente que no resuelve no deja lectura: el tipo de medidor sale del catálogo
 * y sin equipo no hay forma honesta de clasificarla.
 */
import { asc, gt, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords, fuelMeterReadings } from "@/db/schema"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"
import { ARAMCO_SOURCES, COPEC_TCT_SOURCES } from "@/lib/combustibles/fuel-sources"
import {
  aramcoMovementReading,
  copecDetailReading,
  saveMeterReadings,
  type MeterReadingSource,
  type ParsedMeterReading,
} from "@/lib/combustibles/meter-readings"

const BATCH = 500

function sourceFor(fuente: string | null): MeterReadingSource | null {
  if (!fuente) return null
  if (COPEC_TCT_SOURCES.includes(fuente)) return "copec_tct"
  if (ARAMCO_SOURCES.includes(fuente)) return "aramco"
  return null
}

async function main() {
  const vehicles = await db.query.fuelVehicles.findMany({
    columns: { id: true, plate: true, meterType: true },
  })
  const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const byPlateKey = new Map(vehicles.map((vehicle) => [plateMatchKey(vehicle.plate), vehicle]))

  const result = {
    registrosExaminados: 0,
    transaccionesLeidas: 0,
    lecturasGuardadas: 0,
    sinVehiculo: 0,
    fuenteDesconocida: 0,
  }

  let cursor = ""
  for (;;) {
    const batch = await db
      .select({
        id: fuelConsumptionRecords.id,
        vehicleId: fuelConsumptionRecords.vehicleId,
        fuente: fuelConsumptionRecords.fuente,
        rawRow: fuelConsumptionRecords.rawRow,
      })
      .from(fuelConsumptionRecords)
      .where(cursor ? gt(fuelConsumptionRecords.id, cursor) : undefined)
      .orderBy(asc(fuelConsumptionRecords.id))
      .limit(BATCH)
    if (batch.length === 0) break

    for (const record of batch) {
      cursor = record.id
      const detalle = (record.rawRow as { detalle?: unknown } | null)?.detalle
      if (!Array.isArray(detalle) || detalle.length === 0) continue

      const source = sourceFor(record.fuente)
      if (!source) {
        result.fuenteDesconocida += 1
        continue
      }
      result.registrosExaminados += 1
      result.transaccionesLeidas += detalle.length

      const readings = detalle.flatMap((entry): ParsedMeterReading[] => {
        if (!entry || typeof entry !== "object") return []
        const row = entry as Record<string, unknown>
        const reading = source === "aramco" ? aramcoMovementReading(row) : copecDetailReading(row)
        return reading ? [reading] : []
      })
      if (readings.length === 0) continue

      const linked = record.vehicleId ? byId.get(record.vehicleId) : undefined
      const saved = await saveMeterReadings(db, source, readings, (plate) =>
        linked ?? byPlateKey.get(plateMatchKey(plate)))
      result.lecturasGuardadas += saved.saved
      result.sinVehiculo += saved.unresolved
    }
  }

  // `db.execute` devuelve formas distintas según el driver; el select tipado no.
  const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(fuelMeterReadings)

  console.log(JSON.stringify({ ...result, lecturasEnLaTabla: total?.n ?? 0 }, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)

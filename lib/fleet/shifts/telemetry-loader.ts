import { and, between, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { fuelTelemetryDaily, fuelTelemetryFetches, fuelTelemetryHourly, fuelVehicles } from "@/db/schema"
import { addDaysToPlainDate } from "@/lib/utils"
import { HOURLY_SOURCE } from "./constants"
import type { VehicleTelemetry } from "./calc"
import { hourKeyId } from "./hours"
import type { PlainDate } from "./types"

/**
 * Lee de la base lo que `calc.ts` necesita de cada equipo: las filas por hora, cuándo se
 * consultó cada día y los días con fila en el resumen diario. Son cuatro consultas para
 * cualquier número de equipos.
 *
 * Lee desde `fromDay − 1` hasta `toDay + 1`: un turno nocturno del primer día del período
 * empieza el día anterior al que se mira (el equipo-día) y uno del último termina al
 * día siguiente.
 */

/** Postgres devuelve `2026-11-20 14:32:51+00`; se guarda como instante ISO para que `isHourKnown` lo compare. */
function toIso(value: string | null): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value
}

export async function loadVehicleTelemetry(
  vehicleIds: string[],
  fromDay: PlainDate,
  toDay: PlainDate,
): Promise<Map<string, VehicleTelemetry>> {
  const result = new Map<string, VehicleTelemetry>()
  const ids = [...new Set(vehicleIds)]
  if (ids.length === 0) return result

  const from = addDaysToPlainDate(fromDay, -1)
  const to = addDaysToPlainDate(toDay, 1)

  const [vehicles, hourly, fetches, daily] = await Promise.all([
    db.select({ id: fuelVehicles.id, serialNumber: fuelVehicles.serialNumber })
      .from(fuelVehicles)
      .where(inArray(fuelVehicles.id, ids)),
    db.select({
      vehicleId: fuelTelemetryHourly.vehicleId,
      day: fuelTelemetryHourly.day,
      hour: fuelTelemetryHourly.hour,
      idle: fuelTelemetryHourly.idleSeconds,
      working: fuelTelemetryHourly.workingSeconds,
      running: fuelTelemetryHourly.runningSeconds,
    })
      .from(fuelTelemetryHourly)
      .where(and(
        inArray(fuelTelemetryHourly.vehicleId, ids),
        eq(fuelTelemetryHourly.source, HOURLY_SOURCE),
        between(fuelTelemetryHourly.day, from, to),
      )),
    db.select({
      vehicleId: fuelTelemetryFetches.vehicleId,
      day: fuelTelemetryFetches.day,
      segmentsFetchedAt: fuelTelemetryFetches.segmentsFetchedAt,
      dailyFetchedAt: fuelTelemetryFetches.dailyFetchedAt,
    })
      .from(fuelTelemetryFetches)
      .where(and(
        inArray(fuelTelemetryFetches.vehicleId, ids),
        between(fuelTelemetryFetches.day, from, to),
      )),
    db.select({ vehicleId: fuelTelemetryDaily.vehicleId, day: fuelTelemetryDaily.day })
      .from(fuelTelemetryDaily)
      .where(and(
        inArray(fuelTelemetryDaily.vehicleId, ids),
        eq(fuelTelemetryDaily.source, HOURLY_SOURCE),
        between(fuelTelemetryDaily.day, from, to),
      )),
  ])

  // Un id que no existe queda igual en el mapa, sin vincular: quien llama no tiene que distinguirlo.
  const linked = new Map(vehicles.map((vehicle) => [vehicle.id, Boolean(vehicle.serialNumber?.trim())]))
  for (const id of ids) {
    result.set(id, {
      linked: linked.get(id) ?? false,
      hours: new Map(),
      segmentsFetchedAt: new Map(),
      dailyFetchedAt: new Map(),
      dailyRowDays: new Set(),
    })
  }

  for (const row of hourly) {
    result.get(row.vehicleId)?.hours.set(hourKeyId({ day: row.day, hour: row.hour }), {
      idle: row.idle,
      working: row.working,
      running: row.running,
    })
  }
  for (const row of fetches) {
    const tele = result.get(row.vehicleId)
    if (!tele) continue
    const segments = toIso(row.segmentsFetchedAt)
    const dailyAt = toIso(row.dailyFetchedAt)
    if (segments) tele.segmentsFetchedAt.set(row.day, segments)
    if (dailyAt) tele.dailyFetchedAt.set(row.day, dailyAt)
  }
  for (const row of daily) result.get(row.vehicleId)?.dailyRowDays.add(row.day)

  return result
}

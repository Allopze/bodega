import { and, between, eq, gt, inArray, max, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTelemetryDaily, fuelTelemetryFetches, fuelTelemetryHourly, fuelVehicles } from "@/db/schema"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { HOURLY_SOURCE, SIGNAL_LOST_DAYS } from "./constants"
import type { VehicleTelemetry } from "./calc"
import { hourKeyId } from "./hours"
import type { PlainDate } from "./types"

/**
 * Lee de la base lo que `calc.ts` necesita de cada equipo: las filas por hora, cuándo se
 * consultó cada día y el último día en que el equipo transmitió (tramos con motor o fila del
 * resumen diario), del que sale si perdió la señal. Son cinco consultas para cualquier número
 * de equipos.
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
  today: PlainDate = todayInChile(),
): Promise<Map<string, VehicleTelemetry>> {
  const result = new Map<string, VehicleTelemetry>()
  const ids = [...new Set(vehicleIds)]
  if (ids.length === 0) return result

  const from = addDaysToPlainDate(fromDay, -1)
  const to = addDaysToPlainDate(toDay, 1)

  const [vehicles, hourly, fetches, lastSegmentDays, lastDailyDays] = await Promise.all([
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
    })
      .from(fuelTelemetryFetches)
      .where(and(
        inArray(fuelTelemetryFetches.vehicleId, ids),
        between(fuelTelemetryFetches.day, from, to),
      )),
    // Último día con motor en los tramos y último día con fila del resumen diario, de toda la historia:
    // un equipo que transmitió DESPUÉS de un día sin datos estuvo detenido ese día, no sin señal.
    db.select({ vehicleId: fuelTelemetryHourly.vehicleId, day: max(fuelTelemetryHourly.day) })
      .from(fuelTelemetryHourly)
      .where(and(
        inArray(fuelTelemetryHourly.vehicleId, ids),
        eq(fuelTelemetryHourly.source, HOURLY_SOURCE),
        gt(sql`${fuelTelemetryHourly.idleSeconds} + ${fuelTelemetryHourly.workingSeconds} + ${fuelTelemetryHourly.runningSeconds}`, 0),
      ))
      .groupBy(fuelTelemetryHourly.vehicleId),
    db.select({ vehicleId: fuelTelemetryDaily.vehicleId, day: max(fuelTelemetryDaily.day) })
      .from(fuelTelemetryDaily)
      .where(and(inArray(fuelTelemetryDaily.vehicleId, ids), eq(fuelTelemetryDaily.source, HOURLY_SOURCE)))
      .groupBy(fuelTelemetryDaily.vehicleId),
  ])

  const lastReport = new Map<string, PlainDate>()
  for (const row of [...lastSegmentDays, ...lastDailyDays]) {
    if (!row.day) continue
    const current = lastReport.get(row.vehicleId)
    if (!current || row.day > current) lastReport.set(row.vehicleId, row.day)
  }
  const signalLostSince = addDaysToPlainDate(today, -SIGNAL_LOST_DAYS)

  // Un id que no existe queda igual en el mapa, sin vincular: quien llama no tiene que distinguirlo.
  const linked = new Map(vehicles.map((vehicle) => [vehicle.id, Boolean(vehicle.serialNumber?.trim())]))
  for (const id of ids) {
    const lastReportDay = lastReport.get(id) ?? null
    result.set(id, {
      linked: linked.get(id) ?? false,
      hours: new Map(),
      segmentsFetchedAt: new Map(),
      lastReportDay,
      signalLost: lastReportDay === null || lastReportDay <= signalLostSince,
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
    if (segments) tele.segmentsFetchedAt.set(row.day, segments)
  }

  return result
}

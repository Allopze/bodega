import type { Session } from "next-auth"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentLoads, fuelVehicles } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { telemetryLitersPerHour } from "../calc/idle"
import { mandanteWorksitesSql, periodSql, statisticallyValidLoadSql, type ControlFilters } from "../filters"
import { dailyTelemetry, equipmentLabel } from "./idle"

/**
 * V-08: L/h según la telemetría frente al L/h calculado desde las cargas del
 * mismo equipo y mes (promedio del rendimiento `liters_per_hour` de las cargas
 * que entran a estadística, ver `statisticallyValidLoadSql`).
 */

export interface LitersPerHourComparisonRow {
  vehicleId: string
  equipment: string
  month: string
  telemetryLph: number | null
  /** `null` si el mes no tiene cargas con rendimiento calculado. */
  loadsLph: number | null
  loadCount: number
  /** (telemetría − cargas) ÷ cargas; `null` si falta alguno de los dos lados. */
  differencePct: number | null
}

export async function getLitersPerHourComparison(session: Session | null, filters: ControlFilters): Promise<LitersPerHourComparisonRow[]> {
  const d = dailyTelemetry(session, filters)
  const [telemetry, loads] = await Promise.all([
    db.select({
      vehicleId: d.vehicleId,
      code: d.code,
      plate: d.plate,
      month: d.month,
      operating: sql<number>`coalesce(sum(${d.operating}), 0)::float8`,
      litersWorking: sql<number | null>`sum(${d.litersWorking})::float8`,
      litersIdle: sql<number | null>`sum(${d.litersIdle})::float8`,
    }).from(d).groupBy(d.vehicleId, d.code, d.plate, d.month).orderBy(d.code, d.plate, d.vehicleId, d.month),
    db.select({
      vehicleId: fuelEquipmentLoads.vehicleId,
      month: fuelEquipmentLoads.month,
      avg: sql<number>`avg(${fuelEquipmentLoads.performanceValue})::float8`,
      count: sql<number>`count(*)::int`,
    }).from(fuelEquipmentLoads)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
      .where(and(
        statisticallyValidLoadSql,
        eq(fuelEquipmentLoads.performanceUnit, "liters_per_hour"),
        worksiteScopeSql(session, fuelVehicles.worksiteId, filters.worksiteId),
        filters.mandanteId ? sql`${fuelVehicles.worksiteId} in ${mandanteWorksitesSql(filters.mandanteId)}` : undefined,
        periodSql(filters, fuelEquipmentLoads.month, fuelEquipmentLoads.occurredAt),
      ))
      .groupBy(fuelEquipmentLoads.vehicleId, fuelEquipmentLoads.month),
  ])

  const loadsByKey = new Map(loads.map((row) => [`${row.vehicleId}|${row.month}`, row]))
  return telemetry.map((row) => {
    const telemetryLph = telemetryLitersPerHour(row.litersWorking, row.litersIdle, row.operating)
    const load = loadsByKey.get(`${row.vehicleId}|${row.month}`)
    const loadsLph = load?.avg ?? null
    return {
      vehicleId: row.vehicleId,
      equipment: equipmentLabel(row.code, row.plate),
      month: row.month,
      telemetryLph,
      loadsLph,
      loadCount: load?.count ?? 0,
      differencePct: telemetryLph !== null && loadsLph !== null && loadsLph > 0 ? ((telemetryLph - loadsLph) / loadsLph) * 100 : null,
    }
  })
}

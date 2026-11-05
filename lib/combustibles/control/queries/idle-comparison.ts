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
 * mismo equipo y mes.
 *
 * Los dos lados son la misma razón: Σlitros ÷ Σhoras. Sumar los litros y las
 * horas de los tramos y dividir una vez (Σ 50 L/10 h y 40 L/1 h da 90/11 = 8,2)
 * no es lo mismo que promediar las razones (22,5): el promedio de razones hace
 * que una carga chica pese tanto como una grande y pinta la telemetría como
 * «fuera de banda» cuando coincide (hallazgo 3.5 de la auditoría 2026-11-05).
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
      // Σ litros y Σ horas de los tramos: la misma razón de sumas que la telemetría.
      liters: sql<number | null>`sum(${fuelEquipmentLoads.accumulatedLiters})::float8`,
      hours: sql<number | null>`sum(${fuelEquipmentLoads.meterDelta})::float8`,
      // Respaldo para cargas sin los acumulados del tramo: promedio simple, lo único que queda.
      avg: sql<number | null>`avg(${fuelEquipmentLoads.performanceValue})::float8`,
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
    const loadLiters = load?.liters === null || load?.liters === undefined ? null : Number(load.liters)
    const loadHours = load?.hours === null || load?.hours === undefined ? null : Number(load.hours)
    const loadsLph = load
      ? loadLiters !== null && loadHours !== null && loadHours > 0
        ? loadLiters / loadHours
        : (load.avg === null ? null : Number(load.avg))
      : null
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

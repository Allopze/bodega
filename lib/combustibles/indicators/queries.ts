import "server-only"
import type { Session } from "next-auth"
import { and, desc, eq, sql, type AnyColumn } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentLoads, fuelEquipmentTypes, fuelVehicles, worksites } from "@/db/schema"
import { buildLoadWhere, countableLoadSql, statisticallyValidLoadSql, type ControlFilters } from "@/lib/combustibles/control/filters"
import { elapsedPeriodDays } from "@/lib/combustibles/panel/format"
import type { PanelFigureBucket, PanelFiguresRaw } from "@/lib/combustibles/panel/figures"
import { fuelPeriodBounds, previousFuelPeriods } from "@/lib/combustibles/period/parse"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

/**
 * Consultas propias de «Indicadores de combustible». Todo lo que ya existía
 * (litros por mes y medio, rendimiento por mes, ralentí, costo del proveedor) se
 * reutiliza tal cual; aquí sólo vive lo que ninguna consulta existente hacía:
 *
 * - `getIndicatorFigures`: las tres cifras del Panel (litros, km/L de camiones, L/h de
 *   maquinaria) del período y del anterior **con filtro de faena**. `getPanelFigures`
 *   no lo admite (el Panel mira todo el alcance de la persona) y esta pantalla sí lo
 *   tiene. Es la misma consulta, con las mismas reglas de qué carga cuenta y qué carga
 *   entra al promedio, para que la cifra de acá sea la del Panel; la prueba PGlite lo
 *   compara bucket por bucket.
 * - `getLitersByWorksite` y `getLitersByEquipmentType`: litros de las cargas de equipos
 *   del período, por faena y por tipo de equipo. Misma regla de «carga que cuenta»
 *   (`countableLoadSql`) y mismo alcance (`buildLoadWhere`) que el total de arriba, así
 *   que los rankings suman lo que dice el tile.
 *
 * El alcance por faena de la sesión lo aplica `buildLoadWhere` (`worksiteScopeSql`).
 */

const num = (value: unknown): number => Number(value ?? 0)

/** Día civil de Chile de un `timestamptz`. */
const chileDate = (column: AnyColumn) => sql`(${column} AT TIME ZONE 'America/Santiago')::date`

/** Filtros de control con un rango y, opcionalmente, una faena: reutiliza `buildLoadWhere` (alcance + ventana). */
function rangeFilters(from: string, to: string, worksiteId?: string): ControlFilters {
  return { year: Number(from.slice(0, 4)), months: [], from, to, page: 1, ...(worksiteId ? { worksiteId } : {}) }
}

const minDate = (a: string, b: string) => (a <= b ? a : b)

/**
 * Sumas del período y del anterior del mismo tipo y largo, en una pasada. El resultado
 * es un `PanelFiguresRaw` de dos buckets (anterior, actual): `buildPanelFigures` lo
 * convierte en las cifras con su variación, incluido el caso del período en curso, que
 * se compara contra los mismos primeros días del anterior y no contra el mes entero.
 */
export async function getIndicatorFigures(
  session: Session,
  resolved: ResolvedFuelPeriod,
  options: { worksiteId?: string; today?: string } = {},
): Promise<PanelFiguresRaw> {
  const today = options.today ?? todayInChile()
  const periods = previousFuelPeriods(resolved.period, 2).map((period) => fuelPeriodBounds(period))
  const previous = periods[0]
  const current = periods[1]
  if (!previous || !current) throw new Error("Los indicadores necesitan el período y el anterior para comparar")

  const day = chileDate(fuelEquipmentLoads.occurredAt)
  const bucketOf = sql<number>`case ${sql.join(
    periods.map((period, index) => sql`when ${day} between ${period.from}::date and ${period.to}::date then ${index}::int`),
    sql` `,
  )} end`

  const truck = and(eq(fuelEquipmentTypes.performanceFamily, "camiones"), eq(fuelVehicles.performanceUnit, "km_per_liter"))!
  const machine = and(eq(fuelEquipmentTypes.performanceFamily, "maquinaria"), eq(fuelVehicles.performanceUnit, "liters_per_hour"))!
  const validTruck = and(statisticallyValidLoadSql, truck)!
  const validMachine = and(statisticallyValidLoadSql, machine)!
  const pendingComputed = and(countableLoadSql, eq(fuelEquipmentLoads.reviewStatus, "flagged"), eq(fuelEquipmentLoads.performanceStatus, "computed"))!

  const elapsed = resolved.status === "en_curso" ? elapsedPeriodDays(resolved.from, resolved.to, today) : 0
  const partialEnd = elapsed > 0 ? minDate(previous.to, addDaysToPlainDate(previous.from, elapsed - 1)) : null
  const partialPrev = partialEnd
    ? sql<number>`coalesce(sum(${fuelEquipmentLoads.liters}) filter (where ${countableLoadSql} and ${day} between ${previous.from}::date and ${partialEnd}::date), 0)::float8`
    : sql<number>`0::float8`

  const rows = await db.select({
    bucket: bucketOf,
    liters: sql<number>`coalesce(sum(${fuelEquipmentLoads.liters}) filter (where ${countableLoadSql}), 0)::float8`,
    loads: sql<number>`(count(*) filter (where ${countableLoadSql}))::int`,
    equipment: sql<number>`(count(distinct ${fuelEquipmentLoads.vehicleId}) filter (where ${countableLoadSql}))::int`,
    truckKm: sql<number>`coalesce(sum(${fuelEquipmentLoads.meterDelta}) filter (where ${validTruck}), 0)::float8`,
    truckLiters: sql<number>`coalesce(sum(${fuelEquipmentLoads.accumulatedLiters}) filter (where ${validTruck}), 0)::float8`,
    truckExcluded: sql<number>`(count(*) filter (where ${pendingComputed} and ${truck}))::int`,
    machineHours: sql<number>`coalesce(sum(${fuelEquipmentLoads.meterDelta}) filter (where ${validMachine}), 0)::float8`,
    machineLiters: sql<number>`coalesce(sum(${fuelEquipmentLoads.accumulatedLiters}) filter (where ${validMachine}), 0)::float8`,
    machineExcluded: sql<number>`(count(*) filter (where ${pendingComputed} and ${machine}))::int`,
    partialPrev,
  }).from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(buildLoadWhere(session, rangeFilters(previous.from, current.to, options.worksiteId)))
    // Por posición: repetir la expresión con parámetros nuevos en el GROUP BY no la reconoce como la del SELECT.
    .groupBy(sql`1`)

  const byBucket = new Map(rows.map((row) => [num(row.bucket), row]))
  const buckets = periods.map((period, index): PanelFigureBucket => {
    const row = byBucket.get(index)
    return {
      from: period.from,
      to: period.to,
      liters: num(row?.liters),
      loads: num(row?.loads),
      equipment: num(row?.equipment),
      truckKm: num(row?.truckKm),
      truckLiters: num(row?.truckLiters),
      truckExcluded: num(row?.truckExcluded),
      machineHours: num(row?.machineHours),
      machineLiters: num(row?.machineLiters),
      machineExcluded: num(row?.machineExcluded),
    }
  })
  return { buckets, partialPrevLiters: partialEnd ? num(byBucket.get(0)?.partialPrev) : null }
}

export interface WorksiteLiters {
  worksiteId: string
  name: string
  liters: number
  equipment: number
}

/** Litros de las cargas de equipos del período por faena, la de más litros primero. */
export async function getLitersByWorksite(session: Session, filters: ControlFilters): Promise<WorksiteLiters[]> {
  const liters = sql<number>`coalesce(sum(${fuelEquipmentLoads.liters}), 0)::float8`
  const rows = await db.select({
    worksiteId: worksites.id,
    name: worksites.name,
    liters,
    equipment: sql<number>`(count(distinct ${fuelEquipmentLoads.vehicleId}))::int`,
  }).from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, fuelEquipmentLoads.worksiteId))
    .where(and(buildLoadWhere(session, filters), countableLoadSql))
    .groupBy(worksites.id, worksites.name)
    .orderBy(desc(liters), worksites.name)
  return rows.map((row) => ({ worksiteId: row.worksiteId, name: row.name, liters: num(row.liters), equipment: num(row.equipment) }))
}

export interface EquipmentTypeLiters {
  /** `null`: equipos sin tipo asignado. */
  typeId: string | null
  name: string
  liters: number
  equipment: number
}

export const NO_EQUIPMENT_TYPE_LABEL = "Sin tipo de equipo"

/** Litros de las cargas de equipos del período por tipo de equipo, el de más litros primero. */
export async function getLitersByEquipmentType(session: Session, filters: ControlFilters): Promise<EquipmentTypeLiters[]> {
  const liters = sql<number>`coalesce(sum(${fuelEquipmentLoads.liters}), 0)::float8`
  const rows = await db.select({
    typeId: fuelEquipmentTypes.id,
    name: fuelEquipmentTypes.name,
    liters,
    equipment: sql<number>`(count(distinct ${fuelEquipmentLoads.vehicleId}))::int`,
  }).from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(and(buildLoadWhere(session, filters), countableLoadSql))
    .groupBy(fuelEquipmentTypes.id, fuelEquipmentTypes.name)
    .orderBy(desc(liters), fuelEquipmentTypes.name)
  return rows.map((row) => ({ typeId: row.typeId, name: row.name ?? NO_EQUIPMENT_TYPE_LABEL, liters: num(row.liters), equipment: num(row.equipment) }))
}

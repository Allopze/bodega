import { and, desc, isNotNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { bucketLabel, isPartialBucket, listBuckets } from "@/lib/indicators/period"
import { nameKey } from "@/lib/mantencion/normalize"
import type { MantViewer } from "../access"
import { correctiveScope, parseDrivers } from "./corrective-union"
import type {
  CorrectiveStats, DriverRow, EquipmentSeriesRow, LookerFilters, MonthlyCount, ResolvedCrossFilters,
} from "./types"

/**
 * Lo que dibuja y suma la pestaña Correctivo sobre la misma unión que la tabla: la tira de cifras, los gráficos
 * de equipos, conductores y meses. Cada uno ignora lo que su bloque emite (`corrective-tab-data.ts` lo explica): el
 * bloque que emite una dimensión no se filtra por ella, así el clic no lo vacía. Las sumas y los conteos se
 * agregan en SQL; sólo los conductores se arman en JS, porque el nombre sale de texto libre (`parseDrivers`).
 */

/** Equipos que dibuja el gráfico de horas y registros. */
export const SERIES_LIMIT = 8

const hoursSum = (column: unknown) => sql<number>`coalesce(sum(${column}), 0)`

/**
 * Cifras del período con todos los filtros: trabajos, horas, equipos distintos y trabajos sin foto de respaldo.
 * «Sin foto» sólo cuenta OT y registros de la plataforma (`photoEligible`): el importador de los formularios
 * anteriores descarta sus columnas de foto, así que esos trabajos no tienen una foto que faltar.
 */
export async function loadCorrectiveStats(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
): Promise<CorrectiveStats> {
  const scope = await correctiveScope(viewer, filters, cross)
  if (!scope) return { total: 0, hours: 0, equipment: 0, photoEligible: 0, withoutPhoto: 0 }
  const { union, where } = scope
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    hours: hoursSum(union.hours),
    equipment: sql<number>`count(distinct ${union.vehicleId})::int`,
    photoEligible: sql<number>`(count(*) filter (where ${union.source} <> 'historial'))::int`,
    withoutPhoto: sql<number>`(count(*) filter (where ${union.source} <> 'historial' and ${union.photoId} is null and ${union.photoUrl} is null))::int`,
  }).from(union).where(where)
  return {
    total: Number(row?.total ?? 0),
    hours: round1(Number(row?.hours ?? 0)),
    equipment: Number(row?.equipment ?? 0),
    photoEligible: Number(row?.photoEligible ?? 0),
    withoutPhoto: Number(row?.withoutPhoto ?? 0),
  }
}

const round1 = (value: number) => Math.round(value * 10) / 10

/** Horas y registros por equipo, de más a menos horas. El gráfico no se filtra por el equipo que él mismo emite. */
export async function loadCorrectiveEquipmentSeries(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  options: { limit?: number } = {},
): Promise<EquipmentSeriesRow[]> {
  const scope = await correctiveScope(viewer, filters, cross, ["equipment"])
  if (!scope) return []
  const { union, where } = scope
  const hours = hoursSum(union.hours)
  const records = sql<number>`count(*)::int`
  const query = db.select({
    vehicleId: union.vehicleId,
    code: sql<string>`max(${union.code})`,
    plate: sql<string>`max(${union.plate})`,
    hours,
    records,
  })
    .from(union)
    .where(and(where, isNotNull(union.vehicleId)))
    .groupBy(union.vehicleId)
    .orderBy(desc(hours), desc(records), sql`max(${union.plate})`)
  const rows = await (options.limit !== undefined && Number.isFinite(options.limit) ? query.limit(options.limit) : query)
  return rows.map((row) => ({
    vehicleId: row.vehicleId ?? "",
    // La patente es lo que se lee en la calle y en el eje del gráfico; el código, si no hay patente.
    label: row.plate || row.code || "Equipo",
    code: row.code,
    plate: row.plate,
    hours: round1(Number(row.hours)),
    records: Number(row.records),
  }))
}

/** Trabajos por mes del período: todos los meses, con cero donde no hubo. El gráfico no se filtra por el mes que emite. */
export async function loadCorrectiveMonthly(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
): Promise<MonthlyCount[]> {
  const scope = await correctiveScope(viewer, filters, cross, ["month"])
  const counts = new Map<string, number>()
  if (scope) {
    const month = sql<string>`left(${scope.union.date}, 7)`
    const rows = await db.select({ month, n: sql<number>`count(*)::int` }).from(scope.union).where(scope.where).groupBy(month)
    for (const row of rows) counts.set(row.month, Number(row.n))
  }
  return listBuckets(filters.from, filters.to, "month").map((key) => ({
    key,
    label: bucketLabel(key, "month"),
    count: counts.get(key) ?? 0,
    partial: isPartialBucket(key, "month"),
  }))
}

/**
 * Conductores del período, de más a menos horas. Las horas de un trabajo se prorratean entre sus conductores. El
 * gráfico no se filtra por el conductor que él mismo emite y necesita la lista completa para atenuar los demás.
 */
export async function loadCorrectiveDrivers(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
): Promise<DriverRow[]> {
  const scope = await correctiveScope(viewer, filters, cross, ["conductor"])
  if (!scope) return []
  const { union, where } = scope
  const rows = await db.select({ driverText: union.driverText, hours: union.hours }).from(union)
    .where(and(where, isNotNull(union.driverText)))
  const drivers = new Map<string, { label: string; records: number; hours: number }>()
  for (const row of rows) {
    const names = parseDrivers(row.driverText)
    const hours = row.hours == null ? 0 : Number(row.hours)
    for (const name of names) {
      const key = nameKey(name)
      const driver = drivers.get(key) ?? { label: name, records: 0, hours: 0 }
      driver.records += 1
      driver.hours += hours / names.length
      drivers.set(key, driver)
    }
  }
  return [...drivers.entries()]
    .map(([key, value]) => ({ key, label: value.label, records: value.records, hours: round1(value.hours) }))
    .sort((a, b) => b.hours - a.hours || b.records - a.records || a.label.localeCompare(b.label, "es"))
}

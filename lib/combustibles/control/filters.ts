import type { Session } from "next-auth"
import { and, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm"
import { fuelEquipmentLoads, fuelEquipmentTypes, fuelVehicles } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { codeYear } from "@/lib/utils"
import { PERFORMANCE_FAMILIES, type PerformanceFamily, type PerformanceUnit } from "./contracts"

/**
 * Filtros de las vistas del control, siempre en la URL (G-01, R-01) para poder
 * compartir la vista. Nombres de parámetro fijos: `anio`, `meses` ("1,2,3"),
 * `faena`, `mandante`, `unidad`, `medio`, `equipo`, `desde`, `hasta`, `pagina`.
 * Un rango `desde`/`hasta` reemplaza a año + meses.
 */
export interface ControlFilters {
  year: number
  months: number[]
  worksiteId?: string
  mandanteId?: string
  family?: PerformanceFamily
  unit?: PerformanceUnit
  supplyMediumId?: string
  equipment?: string
  from?: string
  to?: string
  page: number
}

export const CONTROL_FILTER_PARAMS = ["anio", "meses", "faena", "mandante", "unidad", "medio", "equipo", "desde", "hasta", "pagina"] as const

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/

export function parseControlFilters(sp: SearchParams, defaults: { family?: PerformanceFamily } = {}): ControlFilters {
  const yearRaw = Number(first(sp.anio))
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : codeYear()
  const months = [...new Set((first(sp.meses) ?? "").split(",").map(Number))]
    .filter((month) => Number.isInteger(month) && month >= 1 && month <= 12)
    .sort((left, right) => left - right)
  const unitRaw = first(sp.unidad)
  const familyRaw = first(sp.familia)
  const from = first(sp.desde)
  const to = first(sp.hasta)
  const pageRaw = Number(first(sp.pagina))
  return {
    year,
    months,
    worksiteId: first(sp.faena),
    mandanteId: first(sp.mandante),
    family: defaults.family ?? (PERFORMANCE_FAMILIES.includes(familyRaw as PerformanceFamily) ? (familyRaw as PerformanceFamily) : undefined),
    unit: unitRaw === "km_per_liter" || unitRaw === "liters_per_hour" ? unitRaw : undefined,
    supplyMediumId: first(sp.medio),
    equipment: first(sp.equipo),
    from: from && PLAIN_DATE.test(from) ? from : undefined,
    to: to && PLAIN_DATE.test(to) ? to : undefined,
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
  }
}

/** Serializa a `URLSearchParams` (sin valores por defecto), para enlaces y exportaciones. */
export function controlFiltersToParams(filters: Partial<ControlFilters>): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.year) params.set("anio", String(filters.year))
  if (filters.months?.length) params.set("meses", filters.months.join(","))
  if (filters.worksiteId) params.set("faena", filters.worksiteId)
  if (filters.mandanteId) params.set("mandante", filters.mandanteId)
  if (filters.unit) params.set("unidad", filters.unit)
  if (filters.supplyMediumId) params.set("medio", filters.supplyMediumId)
  if (filters.equipment) params.set("equipo", filters.equipment)
  if (filters.from) params.set("desde", filters.from)
  if (filters.to) params.set("hasta", filters.to)
  if (filters.page && filters.page > 1) params.set("pagina", String(filters.page))
  return params
}

/** Meses "YYYY-MM" que cubren año + meses (todos los del año si no se eligió ninguno). */
export function selectedMonthKeys(filters: Pick<ControlFilters, "year" | "months">): string[] {
  const months = filters.months.length ? filters.months : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  return months.map((month) => `${filters.year}-${String(month).padStart(2, "0")}`)
}

/** Fecha local de Chile de un `timestamptz`, para filtrar por rango de días. */
export function chileDateSql(column: typeof fuelEquipmentLoads.occurredAt) {
  return sql`(${column} AT TIME ZONE 'America/Santiago')::date`
}

/**
 * Período: rango de días si lo hay; si no, año + meses sobre la columna `month`.
 * Sirve para cualquier tabla con `month` y `occurred_at`.
 */
export function periodSql(filters: ControlFilters, monthColumn: typeof fuelEquipmentLoads.month, occurredColumn: typeof fuelEquipmentLoads.occurredAt): SQL {
  if (filters.from || filters.to) {
    return and(
      filters.from ? sql`${chileDateSql(occurredColumn)} >= ${filters.from}::date` : undefined,
      filters.to ? sql`${chileDateSql(occurredColumn)} <= ${filters.to}::date` : undefined,
    )!
  }
  return inArray(monthColumn, selectedMonthKeys(filters))
}

/** Faenas del mandante, como subconsulta (para cualquier columna `worksite_id`). */
export function mandanteWorksitesSql(mandanteId: string): SQL {
  return sql`(select mw.worksite_id from fuel_mandante_worksites mw where mw.mandante_id = ${mandanteId})`
}

/**
 * Carga que cuenta como litros reales: no anulada, no duplicada, no rechazada.
 * Las cargas en revisión SÍ suman litros (el combustible se cargó); solo se
 * excluyen de promedios y desviaciones (ver `statisticallyValidLoadSql`).
 */
export const countableLoadSql: SQL = and(
  isNull(fuelEquipmentLoads.voidedAt),
  isNull(fuelEquipmentLoads.duplicateOfId),
  sql`${fuelEquipmentLoads.reviewStatus} <> 'rejected'`,
)!

/** Carga que entra a promedios y desviaciones: rendimiento calculado y sin revisión pendiente. */
export const statisticallyValidLoadSql: SQL = and(
  countableLoadSql,
  eq(fuelEquipmentLoads.performanceStatus, "computed"),
  inArray(fuelEquipmentLoads.reviewStatus, ["ok", "approved"]),
)!

/**
 * Condiciones de alcance y filtros sobre `fuel_equipment_loads`.
 * El llamador debe hacer `leftJoin(fuelVehicles)` y `leftJoin(fuelEquipmentTypes)`
 * cuando filtra por familia, unidad o equipo (ver `withLoadJoins`).
 */
export function buildLoadWhere(session: Session | null, filters: ControlFilters): SQL {
  const equipmentTerm = filters.equipment ? `%${filters.equipment}%` : undefined
  return and(
    worksiteScopeSql(session, fuelEquipmentLoads.worksiteId, filters.worksiteId),
    filters.mandanteId ? sql`${fuelEquipmentLoads.worksiteId} in ${mandanteWorksitesSql(filters.mandanteId)}` : undefined,
    periodSql(filters, fuelEquipmentLoads.month, fuelEquipmentLoads.occurredAt),
    filters.family ? eq(fuelEquipmentTypes.performanceFamily, filters.family) : undefined,
    filters.unit ? eq(fuelVehicles.performanceUnit, filters.unit) : undefined,
    filters.supplyMediumId ? eq(fuelEquipmentLoads.supplyMediumId, filters.supplyMediumId) : undefined,
    equipmentTerm ? or(ilike(fuelVehicles.code, equipmentTerm), ilike(fuelVehicles.plate, equipmentTerm)) : undefined,
  ) ?? sql`true`
}

/** Joins que `buildLoadWhere` necesita, para no repetirlos en cada consulta. */
export const loadJoins = {
  vehicles: { table: fuelVehicles, on: eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId) },
  equipmentTypes: { table: fuelEquipmentTypes, on: eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId) },
} as const

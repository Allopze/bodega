import type { Session } from "next-auth"
import { and, eq, inArray, ne, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { fuelTaeSubmissions } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { mandanteWorksitesSql, selectedMonthKeys, type ControlFilters } from "../filters"

/**
 * Condiciones compartidas por las consultas de «sellos por mandante» (C-02..C-07).
 * Los datos de terreno salen de `fuel_tae_submissions`, no de la serie
 * `fuel_equipment_loads`: el sello y su cadena solo existen en el envío de terreno.
 */

/** Etiqueta con que se muestra un nombre de persona sin `combustibles:view_personal`. */
export const RESERVED_LABEL = "Reservado"

/** Mes «YYYY-MM» en hora de Chile de un `timestamptz`. */
export function chileMonthSql(column: AnyColumn): SQL<string> {
  return sql<string>`to_char(${column} at time zone 'America/Santiago', 'YYYY-MM')`
}

function chileDaySql(column: AnyColumn): SQL {
  return sql`(${column} at time zone 'America/Santiago')::date`
}

/**
 * Instante de un `text` ISO (`2026-04-01T01:10:00.000Z`) como `timestamptz`.
 * Sólo cuando el texto trae hora: una fecha suelta (`2026-03-01`) es un día
 * civil, no un instante, y pasarla por UTC la correría de día.
 */
function isoInstantSql(column: AnyColumn): SQL {
  return sql`(case when ${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ]' then ${column}::timestamptz end)`
}

/**
 * Mes «YYYY-MM» en hora de Chile de un `text` que guarda un instante ISO, como
 * `fuel_provider_transactions.occurred_at` o `fuel_meter_readings.occurred_at`.
 *
 * `left(occurred_at, 7)` sobre el texto mezcla calendarios: una transacción del
 * 31-mar 22:10 de Chile se guarda `2026-04-01T01:10Z` y caía en abril. Con hora,
 * el texto se convierte a `timestamptz` y se lleva a hora de Chile; una fecha
 * suelta ya es civil y se usa tal cual.
 */
export function isoTextMonthSql(column: AnyColumn): SQL<string> {
  return sql<string>`case
    when ${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ]' then to_char(${isoInstantSql(column)} at time zone 'America/Santiago', 'YYYY-MM')
    when ${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(${column}, 7)
  end`
}

/** Día civil chileno de un `text` ISO, con la misma regla que `isoTextMonthSql`. */
export function isoTextDaySql(column: AnyColumn): SQL {
  return sql`case
    when ${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ]' then (${isoInstantSql(column)} at time zone 'America/Santiago')::date
    when ${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(${column}, 10)::date
  end`
}

/**
 * Período sobre un `timestamptz` (y su columna `month` opcional): el rango
 * `desde`/`hasta` manda sobre año + meses, igual que `periodSql` del módulo.
 */
export function timestampPeriodSql(filters: ControlFilters, column: AnyColumn, monthColumn?: AnyColumn): SQL {
  if (filters.from || filters.to) {
    return and(
      filters.from ? sql`${chileDaySql(column)} >= ${filters.from}::date` : undefined,
      filters.to ? sql`${chileDaySql(column)} <= ${filters.to}::date` : undefined,
    )!
  }
  const keys = selectedMonthKeys(filters)
  return monthColumn ? inArray(monthColumn, keys) : inArray(chileMonthSql(column), keys)
}

/**
 * Período sobre una columna de texto ISO (`2026-03-05T12:00:00Z`), como
 * `fuel_provider_transactions.occurred_at`: el día y el mes se leen en hora de
 * Chile, igual que el resto de las vistas (D1 de la auditoría 2026-11-05).
 */
export function isoTextPeriodSql(filters: ControlFilters, column: AnyColumn): SQL {
  if (filters.from || filters.to) {
    return and(
      filters.from ? sql`${isoTextDaySql(column)} >= ${filters.from}::date` : undefined,
      filters.to ? sql`${isoTextDaySql(column)} <= ${filters.to}::date` : undefined,
    )!
  }
  return inArray(isoTextMonthSql(column), selectedMonthKeys(filters))
}

/** Un sello «falta» si es nulo o solo espacios. */
export function sealMissingSql(column: AnyColumn): SQL {
  return sql`(${column} is null or btrim(${column}) = '')`
}

/**
 * Alcance + mandante + período sobre los envíos de terreno, sin anulados. El
 * filtro `equipo` (id de equipo) solo lo aplican quienes lo piden con `withEquipment`.
 */
export function submissionWhere(session: Session | null, filters: ControlFilters, options: { withEquipment?: boolean } = {}): SQL {
  return and(
    ne(fuelTaeSubmissions.status, "voided"),
    worksiteScopeSql(session, fuelTaeSubmissions.worksiteId, filters.worksiteId),
    filters.mandanteId ? sql`${fuelTaeSubmissions.worksiteId} in ${mandanteWorksitesSql(filters.mandanteId)}` : undefined,
    timestampPeriodSql(filters, fuelTaeSubmissions.loadedAt),
    options.withEquipment && filters.equipment ? eq(fuelTaeSubmissions.vehicleId, filters.equipment) : undefined,
  ) ?? sql`true`
}

/**
 * Rango de días de una pantalla de cuadratura. La cuadratura se mide por mes
 * completo (las entradas del proveedor y los totales de la tarjeta llegan por
 * mes): con una semana o un rango, el período se ensancha a los meses completos
 * que toca. Mes, trimestre y año ya son meses completos y quedan como están.
 */
export function wholeMonthRange(period: Pick<ResolvedFuelPeriod, "from" | "to" | "monthKeys" | "isWholeMonths">): { from: string; to: string } {
  if (period.isWholeMonths) return { from: period.from, to: period.to }
  const firstKey = period.monthKeys[0]
  const lastKey = period.monthKeys[period.monthKeys.length - 1]
  if (!firstKey || !lastKey) return { from: period.from, to: period.to }
  const [lastYear = 0, lastMonth = 1] = lastKey.split("-").map(Number)
  const lastDay = new Date(Date.UTC(lastYear, lastMonth, 0)).getUTCDate()
  return { from: `${firstKey}-01`, to: `${lastKey}-${String(lastDay).padStart(2, "0")}` }
}

/** `ControlFilters` sobre un rango de días civiles (el período de la cabecera); `year` y `months` no se usan cuando hay rango. */
export function controlFiltersForRange(
  range: { from: string; to: string },
  extra: Partial<Omit<ControlFilters, "from" | "to" | "year" | "months">> = {},
): ControlFilters {
  return { year: Number(range.from.slice(0, 4)), months: [], page: 1, ...extra, from: range.from, to: range.to }
}

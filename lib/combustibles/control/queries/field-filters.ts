import type { Session } from "next-auth"
import { and, eq, inArray, ne, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { fuelTaeSubmissions } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
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

/** Período sobre una columna de texto ISO (`2026-03-05T12:00:00Z`), como `fuel_provider_transactions.occurred_at`. */
export function isoTextPeriodSql(filters: ControlFilters, column: AnyColumn): SQL {
  if (filters.from || filters.to) {
    return and(
      filters.from ? sql`left(${column}, 10) >= ${filters.from}` : undefined,
      filters.to ? sql`left(${column}, 10) <= ${filters.to}` : undefined,
    )!
  }
  return inArray(sql`left(${column}, 7)`, selectedMonthKeys(filters))
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

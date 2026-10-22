/**
 * Agregados de cargas TAE por dimensión operacional (sección 5): supervisor,
 * conductor y punto de suministro. Sólo TAE tiene estos tres campos — TCT y
 * facturación no registran conductor/supervisor/lugar de carga por fila.
 */

import type { Session } from "next-auth"
import { and, eq, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeLoadingPoints, fuelTaeSubmissions } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { canViewFuelPersonalData } from "@/lib/combustibles/fuel-log"
import { PERSONAL_DATA_LABEL } from "@/lib/combustibles/fuel-log-shared"

export type TaeGroupDimension = "driver" | "supervisor" | "loadingPoint"

export interface TaeGroupRow {
  group: string
  liters: number
  count: number
}

export interface TaeDashboardFilters {
  worksiteId?: string
  from: string // "YYYY-MM-DD", hora de Chile
  to: string
}

export async function getTaeGroupedTotals(session: Session, filters: TaeDashboardFilters, dimension: TaeGroupDimension): Promise<TaeGroupRow[]> {
  const where = and(
    worksiteScopeSql(session, fuelTaeSubmissions.worksiteId),
    filters.worksiteId ? eq(fuelTaeSubmissions.worksiteId, filters.worksiteId) : undefined,
    // Igual que el resto de las consultas TAE: comparar por fecha de Chile, no
    // por el timestamptz crudo — evita correr el filtro 3-4 horas cerca de medianoche.
    sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date >= ${filters.from}::date`,
    sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date <= ${filters.to}::date`,
    ne(fuelTaeSubmissions.status, "voided"),
  )

  if (dimension === "loadingPoint") {
    const rows = await db.select({
      group: sql<string | null>`${fuelTaeLoadingPoints.name}`,
      liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)`,
      count: sql<number>`count(*)`,
    })
      .from(fuelTaeSubmissions)
      .leftJoin(fuelTaeLoadingPoints, eq(fuelTaeSubmissions.loadingPointId, fuelTaeLoadingPoints.id))
      .where(where)
      .groupBy(fuelTaeLoadingPoints.name)
    return rows.map((row) => ({ group: row.group ?? "Sin punto asignado", liters: Number(row.liters), count: Number(row.count) })).sort((a, b) => b.liters - a.liters)
  }

  // Sin `view_personal` el agrupamiento por persona conserva litros y cargas (son
  // agregados operacionales) pero no revela quién es cada una: los grupos salen
  // numerados por volumen, "Reservado 1", "Reservado 2"…, resuelto aquí en el
  // servidor para que el nombre nunca viaje al navegador.
  const personal = canViewFuelPersonalData(session)
  const column = dimension === "driver" ? fuelTaeSubmissions.driverNameSnapshot : fuelTaeSubmissions.supervisorNameSnapshot
  const rows = await db.select({
    group: column,
    liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)`,
    count: sql<number>`count(*)`,
  })
    .from(fuelTaeSubmissions)
    .where(where)
    .groupBy(column)
  const sorted = rows.map((row) => ({ group: row.group, liters: Number(row.liters), count: Number(row.count) })).sort((a, b) => b.liters - a.liters)
  if (personal) return sorted
  return sorted.map((row, index) => ({ ...row, group: `${PERSONAL_DATA_LABEL} ${index + 1}` }))
}

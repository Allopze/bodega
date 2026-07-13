/**
 * Resumen del log operacional de combustible (`fuel_operation_records`) para
 * el dashboard de `/combustibles`. A diferencia de `consumption-dashboard.ts`
 * (consumo agregado por patente/período, importado manualmente), esta data
 * viene por transacción con rendimiento ya calculado — solo se agrega.
 */

import type { Session } from "next-auth"
import { and, eq, gte, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { fuelOperationRecords } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import type { PatenteRankingRow, RendimientoRow } from "./consumption-dashboard"
import { flagOutliers as flagOutliersGeneric } from "./performance-statistics"

export interface OperationsSummary {
  totalLitros: number
  totalMonto: number
  totalEquipos: number
  totalRegistros: number
  rendimientoPromedioPonderado: number
  topEquiposPorGasto: PatenteRankingRow[]
  rendimientoPorEquipo: RendimientoRow[]
  porFaena: Array<{ faena: string; litros: number; monto: number; equipos: number }>
  porProveedor: Array<{ proveedor: string; litros: number; monto: number; transacciones: number }>
}

export interface OperationsFilters {
  fromDate?: string
  toDate?: string
  worksiteId?: string
  patente?: string
  associated?: "yes" | "no"
  /** Nombre crudo del proveedor tal como aparece en `porProveedor` — incluye el
   *  literal "Sin proveedor" que usa esa agregación para filas sin dato. */
  proveedorNombre?: string
}

/** Comparte con el dashboard los filtros que existen realmente en el log operacional. */
export function buildOperationsWhere(session: Session, filters: OperationsFilters = {}): SQL | undefined {
  const conditions: Array<SQL | undefined> = [
    filters.fromDate ? gte(fuelOperationRecords.fecha, filters.fromDate) : undefined,
    filters.toDate ? lte(fuelOperationRecords.fecha, filters.toDate) : undefined,
    filters.worksiteId ? eq(fuelOperationRecords.worksiteId, filters.worksiteId) : undefined,
    filters.patente ? eq(fuelOperationRecords.plate, filters.patente.trim().toUpperCase()) : undefined,
    filters.associated === "yes" ? isNotNull(fuelOperationRecords.vehicleId) : undefined,
    filters.associated === "no" ? isNull(fuelOperationRecords.vehicleId) : undefined,
    filters.proveedorNombre === "Sin proveedor" ? isNull(fuelOperationRecords.proveedorNombre)
      : filters.proveedorNombre ? eq(fuelOperationRecords.proveedorNombre, filters.proveedorNombre) : undefined,
    worksiteScopeSql(session, fuelOperationRecords.worksiteId),
  ]
  const defined = conditions.filter((condition): condition is SQL => condition !== undefined)
  return defined.length > 0 ? and(...defined) : undefined
}

/** Devuelve null si no hay ningún registro visible para la sesión — evita
 *  mostrar una sección vacía en faenas que no usan este log operacional. */
export async function getOperationsSummary(session: Session, filters: OperationsFilters = {}): Promise<OperationsSummary | null> {
  const where = buildOperationsWhere(session, filters)

  const [[totals], byEquipoRaw, porFaenaRaw, porProveedorRaw] = await Promise.all([
    db.select({
      totalLitros: sql<number>`coalesce(sum(${fuelOperationRecords.liters}), 0)`,
      totalMonto: sql<number>`coalesce(sum(${fuelOperationRecords.monto}), 0)`,
      totalEquipos: sql<number>`count(distinct ${fuelOperationRecords.plate})`,
      totalRegistros: sql<number>`count(*)`,
      rendimientoPonderado: sql<number>`case when sum(${fuelOperationRecords.liters}) > 0
        then sum(coalesce(${fuelOperationRecords.rendimiento}, 0) * ${fuelOperationRecords.liters}) / sum(${fuelOperationRecords.liters})
        else 0 end`,
    }).from(fuelOperationRecords).where(where),

    db.select({
      plate: fuelOperationRecords.plate,
      code: sql<string | null>`max(${fuelOperationRecords.code})`,
      cantidad: sql<number>`coalesce(sum(${fuelOperationRecords.liters}), 0)`,
      monto: sql<number>`coalesce(sum(${fuelOperationRecords.monto}), 0)`,
      transacciones: sql<number>`count(*)`,
      rendimiento: sql<number>`case when sum(${fuelOperationRecords.liters}) > 0
        then sum(coalesce(${fuelOperationRecords.rendimiento}, 0) * ${fuelOperationRecords.liters}) / sum(${fuelOperationRecords.liters})
        else 0 end`,
      vehicleId: sql<string | null>`max(${fuelOperationRecords.vehicleId})`,
    }).from(fuelOperationRecords).where(where)
      .groupBy(fuelOperationRecords.plate),

    db.select({
      faena: sql<string>`coalesce(${fuelOperationRecords.faenaNombre}, 'Sin faena')`,
      litros: sql<number>`coalesce(sum(${fuelOperationRecords.liters}), 0)`,
      monto: sql<number>`coalesce(sum(${fuelOperationRecords.monto}), 0)`,
      equipos: sql<number>`count(distinct ${fuelOperationRecords.plate})`,
    }).from(fuelOperationRecords).where(where)
      .groupBy(sql`coalesce(${fuelOperationRecords.faenaNombre}, 'Sin faena')`),

    db.select({
      proveedor: sql<string>`coalesce(${fuelOperationRecords.proveedorNombre}, 'Sin proveedor')`,
      litros: sql<number>`coalesce(sum(${fuelOperationRecords.liters}), 0)`,
      monto: sql<number>`coalesce(sum(${fuelOperationRecords.monto}), 0)`,
      transacciones: sql<number>`count(*)`,
    }).from(fuelOperationRecords).where(where)
      .groupBy(sql`coalesce(${fuelOperationRecords.proveedorNombre}, 'Sin proveedor')`),
  ])

  const totalRegistros = Number(totals?.totalRegistros ?? 0)
  if (totalRegistros === 0) return null

  const byEquipo: PatenteRankingRow[] = byEquipoRaw.map((r) => ({
    patente: r.code ? `${r.code} (${r.plate})` : r.plate,
    filterPatente: r.plate,
    cantidad: Number(r.cantidad),
    monto: Number(r.monto),
    transacciones: Number(r.transacciones),
    vehicleId: r.vehicleId,
  }))
  const rendimientosRaw = byEquipoRaw.map((r, i) => ({
    patente: byEquipo[i]!.patente,
    filterPatente: r.plate,
    rendimiento: Number(r.rendimiento),
    cantidad: Number(r.cantidad),
  }))

  return {
    totalLitros: Number(totals?.totalLitros ?? 0),
    totalMonto: Number(totals?.totalMonto ?? 0),
    totalEquipos: Number(totals?.totalEquipos ?? 0),
    totalRegistros,
    rendimientoPromedioPonderado: Number(totals?.rendimientoPonderado ?? 0),
    topEquiposPorGasto: [...byEquipo].sort((a, b) => b.monto - a.monto).slice(0, 10),
    rendimientoPorEquipo: flagOutliersGeneric(rendimientosRaw, (r) => r.rendimiento).sort((a, b) => b.cantidad - a.cantidad).slice(0, 15),
    porFaena: porFaenaRaw.map((r) => ({ faena: r.faena, litros: Number(r.litros), monto: Number(r.monto), equipos: Number(r.equipos) }))
      .sort((a, b) => b.monto - a.monto),
    porProveedor: porProveedorRaw.map((r) => ({ proveedor: r.proveedor, litros: Number(r.litros), monto: Number(r.monto), transacciones: Number(r.transacciones) }))
      .sort((a, b) => b.monto - a.monto),
  }
}

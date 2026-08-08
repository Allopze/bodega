/**
 * Resumen del log operacional de combustible (`fuel_operation_records`) para
 * el dashboard de `/combustibles`. A diferencia de `consumption-dashboard.ts`
 * (consumo agregado por patente/período, importado manualmente), esta data
 * viene por transacción con rendimiento ya calculado — solo se agrega.
 */

import type { Session } from "next-auth"
import { and, eq, gte, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { fuelOperationRecords, fuelVehicles, fuelEquipmentTypes, worksites } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import type { PatenteRankingRow, RendimientoRow } from "./consumption-dashboard"
import { flagOutliers as flagOutliersGeneric } from "./performance-statistics"

export interface OperationsSummary {
  totalLitros: number
  totalMonto: number
  totalEquipos: number
  totalRegistros: number
  topEquiposPorGasto: PatenteRankingRow[]
  /** Cada fila lleva la unidad del rendimiento (`km_lt` | `lt_hr`, o null cuando la
   *  patente no la informa o mezcla las dos). Los atípicos se calculan DENTRO de cada
   *  unidad: km/L y L/h no son la misma población ni tienen la misma polaridad. */
  rendimientoPorEquipo: Array<RendimientoRow & { unidad: string | null }>
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

/** Marca atípicos DENTRO de cada unidad de rendimiento. km/L y L/h no son la misma
 *  población —ni comparten polaridad: en L/h más alto es peor—, así que mezclarlas
 *  marcaba como atípico al equipo normal de la unidad minoritaria (y enmascaraba los
 *  atípicos reales en mezclas parejas). Las filas sin unidad no se comparan con
 *  nadie: solo se marcan si no informan rendimiento. */
export function flagRendimientoPorUnidad<T extends { rendimiento: number; unidad: string | null }>(rows: T[]): Array<T & { atipico: boolean }> {
  const unidades = [...new Set(rows.map((row) => row.unidad))]
  return unidades.flatMap((unidad) => {
    const grupo = rows.filter((row) => row.unidad === unidad)
    return unidad === null
      ? grupo.map((row) => ({ ...row, atipico: row.rendimiento === 0 }))
      : flagOutliersGeneric(grupo, (row) => row.rendimiento)
  })
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
    }).from(fuelOperationRecords).where(where),

    db.select({
      plate: fuelOperationRecords.plate,
      code: sql<string | null>`max(${fuelOperationRecords.code})`,
      cantidad: sql<number>`coalesce(sum(${fuelOperationRecords.liters}), 0)`,
      monto: sql<number>`coalesce(sum(${fuelOperationRecords.monto}), 0)`,
      transacciones: sql<number>`count(*)`,
      // `coalesce(rendimiento, 0)` contaba las cargas sin rendimiento informado
      // como rendimiento 0 real: un equipo con la mitad de sus cargas sin
      // lectura mostraba la mitad de su rendimiento. Se promedian sólo las
      // cargas que sí lo traen.
      rendimiento: sql<number>`case when coalesce(sum(${fuelOperationRecords.liters}) filter (where ${fuelOperationRecords.rendimiento} is not null), 0) > 0
        then sum(${fuelOperationRecords.rendimiento} * ${fuelOperationRecords.liters}) filter (where ${fuelOperationRecords.rendimiento} is not null)
             / sum(${fuelOperationRecords.liters}) filter (where ${fuelOperationRecords.rendimiento} is not null)
        else 0 end`,
      vehicleId: sql<string | null>`max(${fuelOperationRecords.vehicleId})`,
      // Unidad del rendimiento de la patente. No se agrega al groupBy a propósito:
      // `byEquipoRaw` también alimenta "Equipos con mayor gasto" y una patente con
      // filas de ambas unidades aparecería duplicada. null = sin unidad informada o
      // unidades mezcladas → no se compara con nadie.
      unidad: sql<string | null>`case when count(distinct ${fuelOperationRecords.tipoRendimiento}) = 1
        then max(${fuelOperationRecords.tipoRendimiento}) else null end`,
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
    unidad: r.unidad,
  }))

  return {
    totalLitros: Number(totals?.totalLitros ?? 0),
    totalMonto: Number(totals?.totalMonto ?? 0),
    totalEquipos: Number(totals?.totalEquipos ?? 0),
    totalRegistros,
    topEquiposPorGasto: [...byEquipo].sort((a, b) => b.monto - a.monto).slice(0, 10),
    rendimientoPorEquipo: flagRendimientoPorUnidad(rendimientosRaw).sort((a, b) => b.cantidad - a.cantidad).slice(0, 15),
    porFaena: porFaenaRaw.map((r) => ({ faena: r.faena, litros: Number(r.litros), monto: Number(r.monto), equipos: Number(r.equipos) }))
      .sort((a, b) => b.monto - a.monto),
    porProveedor: porProveedorRaw.map((r) => ({ proveedor: r.proveedor, litros: Number(r.litros), monto: Number(r.monto), transacciones: Number(r.transacciones) }))
      .sort((a, b) => b.monto - a.monto),
  }
}

export interface ScatterPoint {
  plate: string
  equipmentCode: string | null
  equipmentTypeName: string | null
  worksiteName: string | null
  liters: number
  meterReading: number
  /** "km" o "hora" — lo que mide el medidor en este registro. */
  medidoPor: string
}

/** Observaciones individuales del log operacional para gráficos de dispersión
 *  (litros vs km y litros vs horómetro). Sólo filas con lectura de medidor
 *  válida y litros > 0. El llamador separa por `medidoPor` antes de graficar:
 *  nunca se mezclan km con horas en el mismo eje. */
export async function getScatterObservations(session: Session, filters: OperationsFilters = {}): Promise<ScatterPoint[]> {
  const where = buildOperationsWhere(session, filters)
  const rows = await db.select({
    plate: fuelOperationRecords.plate,
    equipmentCode: fuelVehicles.code,
    equipmentTypeName: fuelEquipmentTypes.name,
    worksiteName: worksites.name,
    liters: fuelOperationRecords.liters,
    meterReading: fuelOperationRecords.horometro,
    medidoPor: fuelOperationRecords.medidoPor,
  })
    .from(fuelOperationRecords)
    .leftJoin(fuelVehicles, eq(fuelOperationRecords.vehicleId, fuelVehicles.id))
    .leftJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
    .leftJoin(worksites, eq(fuelOperationRecords.worksiteId, worksites.id))
    .where(and(
      where,
      isNotNull(fuelOperationRecords.horometro),
      sql`${fuelOperationRecords.liters} > 0`,
    ))
    .limit(3000) // suficiente para un scatter sin saturar el navegador

  return rows.map((r) => ({
    plate: r.plate,
    equipmentCode: r.equipmentCode,
    equipmentTypeName: r.equipmentTypeName,
    worksiteName: r.worksiteName,
    liters: Number(r.liters),
    meterReading: Number(r.meterReading),
    medidoPor: r.medidoPor ?? "sin unidad",
  })).filter((r) => r.medidoPor === "km" || r.medidoPor === "hora")
}

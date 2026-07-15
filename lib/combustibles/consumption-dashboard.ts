/**
 * Servicio de datos del dashboard de consumos de combustible por patente.
 * Centraliza KPIs, series y alertas para que la page.tsx solo arme la UI.
 */

import type { Session } from "next-auth"
import { sql, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords } from "@/db/schema"
import { buildConsumptionWhere, type ConsumptionFilters } from "./consumption-queries"
import { calcVariacion } from "./consumption-calculations"
import { flagOutliers as flagOutliersGeneric } from "./performance-statistics"
import { previousPeriod, dateOnly, daysAgo } from "@/lib/services/analytics-module/helpers"
import { fuelVehicles, fuelEquipmentTypes, worksites } from "@/db/schema"

export interface ConsumptionAlert {
  type: string
  severity: "low" | "medium" | "high" | "critical"
  entityLabel: string
  reason: string
  action: string
  /** Query string para enlazar al detalle filtrado (p. ej. "patente=ABCD12"). */
  linkQuery: string
}

export interface PeriodoRow { periodo: string; cantidad: number; monto: number; precioPromedio: number | null }
export interface PatenteRankingRow {
  patente: string
  /** Patente real para filtrar, cuando el rótulo visible incluye el código del equipo. */
  filterPatente?: string
  cantidad: number
  monto: number
  transacciones: number
  vehicleId: string | null
}
export interface RendimientoRow {
  patente: string
  /** Patente real para filtrar, cuando el rótulo visible incluye el código del equipo. */
  filterPatente?: string
  rendimiento: number
  cantidad: number
  atipico: boolean
}

export interface ConsumptionDashboardData {
  filters: Required<Pick<ConsumptionFilters, "fromDate" | "toDate">> & Omit<ConsumptionFilters, "fromDate" | "toDate">
  kpis: {
    totalCantidad: number
    totalMonto: number
    precioPromedioUnidad: number | null
    totalTransacciones: number
    totalTarjetas: number
    patentesUnicas: number
    rendimientoPromedioPonderado: number
    patentesSinAsociacion: number
    variacionCantidadPct: number | null
    variacionMontoPct: number | null
  }
  seriesPorPeriodo: PeriodoRow[]
  topPatentesPorConsumo: PatenteRankingRow[]
  topPatentesPorGasto: PatenteRankingRow[]
  transaccionesPorPatente: PatenteRankingRow[]
  rendimientoPorPatente: RendimientoRow[]
  alerts: ConsumptionAlert[]
}

/** ponytail: Umbral de variación porcentual para activar alerta de "variación fuerte"
 *  respecto al período anterior (dashboard de combustibles). */
export const VARIACION_FUERTE_PCT = 30

/** ponytail: Umbral de transacciones en el período para activar alerta de
 *  "transacciones altas" por patente. */
export const TRANSACCIONES_ALTAS = 30

/** ponytail: Ventana por defecto en días hacia atrás cuando no hay filtro de fecha.
 *  Controla el alcance del dashboard de consumo y sus alertas. */
export const DEFAULT_DAYS_AGO = 30

/** ponytail: Cantidad máxima de patentes en rankings "top N" (consumo, gasto,
 *  transacciones). Son límites de presentación, no operativos. */
export const TOP_PATENTES_LIMIT = 10

/** ponytail: Cantidad máxima de filas en el ranking de rendimiento por patente. */
export const TOP_RENDIMIENTO_LIMIT = 15

/** ponytail: Multiplicador sobre el monto medio para determinar gasto alto
 *  con rendimiento bajo en alertas. */
export const MONTO_MEDIO_ALERT_MULTIPLIER = 1.5

/** ponytail: Mínimo de patentes necesario para activar alertas de "consumo alto"
 *  (top N requiere al menos N*2 patentes para que "top" sea significativo). */
export const MIN_PATENTES_FOR_ALERT = 4

/** ponytail: Cuántas patentes mostrar en alertas de consumo alto, transacciones
 *  altas y rendimiento cero respectivamente. */
export const CONSUMO_ALTO_ALERT_COUNT = 3
export const TRANSACCIONES_ALTAS_ALERT_COUNT = 3
export const RENDIMIENTO_CERO_ALERT_COUNT = 5

export function normalizeConsumptionFilters(input: ConsumptionFilters, now: Date = new Date()) {
  return {
    fromDate: input.fromDate ?? daysAgo(now, DEFAULT_DAYS_AGO),
    toDate: input.toDate ?? dateOnly(now),
    ...(input.worksiteId ? { worksiteId: input.worksiteId } : {}),
    ...(input.fuente ? { fuente: input.fuente } : {}),
    ...(input.patente ? { patente: input.patente } : {}),
    ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
    ...(input.associated ? { associated: input.associated } : {}),
    ...(input.montoMin != null ? { montoMin: input.montoMin } : {}),
    ...(input.montoMax != null ? { montoMax: input.montoMax } : {}),
    ...(input.cantidadMin != null ? { cantidadMin: input.cantidadMin } : {}),
    ...(input.cantidadMax != null ? { cantidadMax: input.cantidadMax } : {}),
  }
}

export async function getConsumptionDashboard(session: Session, rawFilters: ConsumptionFilters = {}): Promise<ConsumptionDashboardData> {
  const filters = normalizeConsumptionFilters(rawFilters)
  const where = buildConsumptionWhere(session, filters)
  const previous = previousPeriod(filters.fromDate, filters.toDate)
  const previousWhere = buildConsumptionWhere(session, { ...filters, fromDate: previous.fromDate, toDate: previous.toDate })

  const [
    [totals], [previousTotals], seriesPorPeriodoRaw, byPatenteRaw,
  ] = await Promise.all([
    db.select({
      totalCantidad: sql<number>`coalesce(sum(${fuelConsumptionRecords.cantidadUnidad}), 0)`,
      totalMonto: sql<number>`coalesce(sum(${fuelConsumptionRecords.monto}), 0)`,
      totalTransacciones: sql<number>`coalesce(sum(${fuelConsumptionRecords.numeroTransacciones}), 0)`,
      totalTarjetas: sql<number>`coalesce(sum(${fuelConsumptionRecords.numeroTarjetas}), 0)`,
      patentesUnicas: sql<number>`count(distinct ${fuelConsumptionRecords.patente})`,
      patentesSinAsociacion: sql<number>`count(distinct ${fuelConsumptionRecords.patente}) filter (where ${fuelConsumptionRecords.vehicleId} is null)`,
      rendimientoPonderado: sql<number>`case when sum(${fuelConsumptionRecords.cantidadUnidad}) > 0
        then sum(${fuelConsumptionRecords.rendimientoPromedio} * ${fuelConsumptionRecords.cantidadUnidad}) / sum(${fuelConsumptionRecords.cantidadUnidad})
        else 0 end`,
    }).from(fuelConsumptionRecords).where(where),

    db.select({
      totalCantidad: sql<number>`coalesce(sum(${fuelConsumptionRecords.cantidadUnidad}), 0)`,
      totalMonto: sql<number>`coalesce(sum(${fuelConsumptionRecords.monto}), 0)`,
    }).from(fuelConsumptionRecords).where(previousWhere),

    db.select({
      periodo: fuelConsumptionRecords.periodoDesde,
      cantidad: sql<number>`coalesce(sum(${fuelConsumptionRecords.cantidadUnidad}), 0)`,
      monto: sql<number>`coalesce(sum(${fuelConsumptionRecords.monto}), 0)`,
    }).from(fuelConsumptionRecords).where(where)
      .groupBy(fuelConsumptionRecords.periodoDesde)
      .orderBy(fuelConsumptionRecords.periodoDesde),

    db.select({
      patente: fuelConsumptionRecords.patente,
      cantidad: sql<number>`coalesce(sum(${fuelConsumptionRecords.cantidadUnidad}), 0)`,
      monto: sql<number>`coalesce(sum(${fuelConsumptionRecords.monto}), 0)`,
      transacciones: sql<number>`coalesce(sum(${fuelConsumptionRecords.numeroTransacciones}), 0)`,
      rendimiento: sql<number>`case when sum(${fuelConsumptionRecords.cantidadUnidad}) > 0
        then sum(${fuelConsumptionRecords.rendimientoPromedio} * ${fuelConsumptionRecords.cantidadUnidad}) / sum(${fuelConsumptionRecords.cantidadUnidad})
        else 0 end`,
      // Un mismo vehicleId siempre que la patente esté asociada en todas sus filas del período.
      vehicleId: sql<string | null>`max(${fuelConsumptionRecords.vehicleId})`,
    }).from(fuelConsumptionRecords).where(where)
      .groupBy(fuelConsumptionRecords.patente),
  ])

  const totalCantidad = Number(totals?.totalCantidad ?? 0)
  const totalMonto = Number(totals?.totalMonto ?? 0)
  const totalTransacciones = Number(totals?.totalTransacciones ?? 0)
  const totalTarjetas = Number(totals?.totalTarjetas ?? 0)
  const patentesUnicas = Number(totals?.patentesUnicas ?? 0)
  const patentesSinAsociacion = Number(totals?.patentesSinAsociacion ?? 0)
  const rendimientoPromedioPonderado = Number(totals?.rendimientoPonderado ?? 0)

  const previousCantidad = Number(previousTotals?.totalCantidad ?? 0)
  const previousMonto = Number(previousTotals?.totalMonto ?? 0)

  const seriesPorPeriodo: PeriodoRow[] = seriesPorPeriodoRaw.map((r) => {
    const cantidad = Number(r.cantidad)
    const monto = Number(r.monto)
    return { periodo: r.periodo, cantidad, monto, precioPromedio: cantidad > 0 ? monto / cantidad : null }
  })

  const byPatente: PatenteRankingRow[] = byPatenteRaw.map((r) => ({
    patente: r.patente,
    cantidad: Number(r.cantidad),
    monto: Number(r.monto),
    transacciones: Number(r.transacciones),
    vehicleId: r.vehicleId,
  }))

  const topPatentesPorConsumo = [...byPatente].sort((a, b) => b.cantidad - a.cantidad).slice(0, TOP_PATENTES_LIMIT)
  const topPatentesPorGasto = [...byPatente].sort((a, b) => b.monto - a.monto).slice(0, TOP_PATENTES_LIMIT)
  const transaccionesPorPatente = [...byPatente].sort((a, b) => b.transacciones - a.transacciones).slice(0, TOP_PATENTES_LIMIT)

  const rendimientosRaw = byPatenteRaw.map((r) => ({ patente: r.patente, rendimiento: Number(r.rendimiento), cantidad: Number(r.cantidad) }))
  const rendimientoPorPatente = flagOutliersGeneric(rendimientosRaw, (r) => r.rendimiento)

  const alerts = buildConsumptionAlerts({
    byPatente, rendimientoPorPatente, patentesSinAsociacion,
    variacionMontoPct: calcVariacion(totalMonto, previousMonto),
    variacionCantidadPct: calcVariacion(totalCantidad, previousCantidad),
  })

  return {
    filters,
    kpis: {
      totalCantidad, totalMonto,
      precioPromedioUnidad: totalCantidad > 0 ? totalMonto / totalCantidad : null,
      totalTransacciones, totalTarjetas, patentesUnicas, rendimientoPromedioPonderado, patentesSinAsociacion,
      variacionCantidadPct: calcVariacion(totalCantidad, previousCantidad),
      variacionMontoPct: calcVariacion(totalMonto, previousMonto),
    },
    seriesPorPeriodo, topPatentesPorConsumo, topPatentesPorGasto, transaccionesPorPatente,
    rendimientoPorPatente: rendimientoPorPatente.sort((a, b) => b.cantidad - a.cantidad).slice(0, TOP_RENDIMIENTO_LIMIT),
    alerts,
  }
}

export interface EquipmentTypeConsumptionRow {
  equipmentTypeName: string
  totalLiters: number
  totalAmount: number
  transactionCount: number
  uniqueVehicles: number
}

/** Litros totales agrupados por tipo de equipo, para el gráfico de la sección 5. */
export async function getConsumptionByEquipmentType(session: Session, filters: Pick<ConsumptionFilters, "fromDate" | "toDate" | "worksiteId">): Promise<EquipmentTypeConsumptionRow[]> {
  const norm = normalizeConsumptionFilters(filters)
  const where = buildConsumptionWhere(session, norm)
  if (!where) return []

  const rows = await db.select({
    equipmentTypeName: fuelEquipmentTypes.name,
    totalLiters: sql<number>`coalesce(sum(${fuelConsumptionRecords.cantidadUnidad}), 0)`,
    totalAmount: sql<number>`coalesce(sum(${fuelConsumptionRecords.monto}), 0)`,
    transactionCount: sql<number>`coalesce(sum(${fuelConsumptionRecords.numeroTransacciones}), 0)`,
    uniqueVehicles: sql<number>`count(distinct ${fuelVehicles.id})`,
  })
    .from(fuelConsumptionRecords)
    .innerJoin(fuelVehicles, eq(fuelConsumptionRecords.vehicleId, fuelVehicles.id))
    .innerJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
    .where(where)
    .groupBy(fuelEquipmentTypes.name)
    .orderBy(sql`totalLiters desc`)

  return rows.map((r) => ({
    equipmentTypeName: r.equipmentTypeName,
    totalLiters: Number(r.totalLiters),
    totalAmount: Number(r.totalAmount),
    transactionCount: Number(r.transactionCount),
    uniqueVehicles: Number(r.uniqueVehicles),
  })).filter((r) => r.totalLiters > 0)
}

export interface VehicleEvolutionPoint {
  periodo: string
  plate: string
  vehicleCode: string | null
  vehicleId: string | null
  liters: number
  amount: number
}

/** Serie temporal por vehículo para gráfico de evolución individual
 *  (sección 5). Cada punto es un período/vehículo con litros y monto agregados. */
export async function getEvolutionByVehicle(session: Session, filters: Pick<ConsumptionFilters, "fromDate" | "toDate" | "worksiteId" | "patente">): Promise<VehicleEvolutionPoint[]> {
  const norm = normalizeConsumptionFilters(filters)
  const where = buildConsumptionWhere(session, norm)
  if (!where) return []

  const rows = await db.select({
    periodo: fuelConsumptionRecords.periodoDesde,
    plate: fuelConsumptionRecords.patente,
    vehicleCode: fuelVehicles.code,
    vehicleId: fuelVehicles.id,
    liters: sql<number>`coalesce(sum(${fuelConsumptionRecords.cantidadUnidad}), 0)`,
    amount: sql<number>`coalesce(sum(${fuelConsumptionRecords.monto}), 0)`,
  })
    .from(fuelConsumptionRecords)
    .leftJoin(fuelVehicles, eq(fuelConsumptionRecords.vehicleId, fuelVehicles.id))
    .where(where)
    .groupBy(fuelConsumptionRecords.periodoDesde, fuelConsumptionRecords.patente, fuelVehicles.code, fuelVehicles.id)
    .orderBy(fuelConsumptionRecords.periodoDesde)
    .limit(3000)

  return rows.map((r) => ({
    periodo: r.periodo,
    plate: r.plate,
    vehicleCode: r.vehicleCode,
    vehicleId: r.vehicleId,
    liters: Number(r.liters),
    amount: Number(r.amount),
  }))
}

export interface HeatmapCell {
  worksiteName: string
  equipmentLabel: string
  /** Litros totales en el período para esta faena+equipo. */
  liters: number
  /** Monto total. */
  amount: number
  /** Ranking relativo (0–1) entre los litros visibles para intensidad de color. */
  intensity: number
}

/** Matriz faena × equipo para el mapa de calor (sección 5).
 *  Agrupa por faena y equipo (código+patente), devuelve top-50 combinaciones. */
export async function getWorksiteEquipmentMatrix(session: Session, filters: Pick<ConsumptionFilters, "fromDate" | "toDate" | "worksiteId">): Promise<HeatmapCell[]> {
  const norm = normalizeConsumptionFilters(filters)
  const where = buildConsumptionWhere(session, norm)
  if (!where) return []

  const rows = await db.select({
    worksiteName: worksites.name,
    equipmentCode: fuelVehicles.code,
    plate: fuelConsumptionRecords.patente,
    liters: sql<number>`coalesce(sum(${fuelConsumptionRecords.cantidadUnidad}), 0)`,
    amount: sql<number>`coalesce(sum(${fuelConsumptionRecords.monto}), 0)`,
  })
    .from(fuelConsumptionRecords)
    .innerJoin(fuelVehicles, eq(fuelConsumptionRecords.vehicleId, fuelVehicles.id))
    .innerJoin(worksites, eq(fuelVehicles.worksiteId, worksites.id))
    .where(where)
    .groupBy(worksites.name, fuelVehicles.code, fuelConsumptionRecords.patente)
    .orderBy(sql`liters desc`)
    .limit(50)

  const cells = rows.map((r) => ({
    worksiteName: r.worksiteName ?? "Sin faena",
    equipmentLabel: r.equipmentCode ? `${r.equipmentCode} (${r.plate})` : r.plate,
    liters: Number(r.liters),
    amount: Number(r.amount),
    intensity: 0,
  })).filter((c) => c.liters > 0)

  const maxLiters = cells.length > 0 ? Math.max(...cells.map((c) => c.liters)) : 1
  return cells.map((c) => ({ ...c, intensity: c.liters / maxLiters }))
}

function buildConsumptionAlerts(input: {
  byPatente: PatenteRankingRow[]
  rendimientoPorPatente: RendimientoRow[]
  patentesSinAsociacion: number
  variacionMontoPct: number | null
  variacionCantidadPct: number | null
}): ConsumptionAlert[] {
  const alerts: ConsumptionAlert[] = []
  const { byPatente, rendimientoPorPatente } = input

  // Consumo inusualmente alto (top N por consumo, si hay suficientes patentes para que "top" signifique algo).
  if (byPatente.length >= MIN_PATENTES_FOR_ALERT) {
    for (const row of [...byPatente].sort((a, b) => b.cantidad - a.cantidad).slice(0, CONSUMO_ALTO_ALERT_COUNT)) {
      alerts.push({
        type: "consumo_alto", severity: "medium", entityLabel: row.patente,
        reason: `Consumió ${Math.round(row.cantidad).toLocaleString("es-CL")} L en el período, el mayor del grupo filtrado.`,
        action: "Revisar bitácora de uso y compararla con la operación asignada.",
        linkQuery: `patente=${encodeURIComponent(row.patente)}`,
      })
    }
  }

  // Monto alto + rendimiento bajo (no cero, ese caso ya se marca aparte).
  const rendByPatente = new Map(rendimientoPorPatente.map((r) => [r.patente, r]))
  const montoMedio = byPatente.length > 0 ? byPatente.reduce((s, r) => s + r.monto, 0) / byPatente.length : 0
  for (const row of byPatente) {
    const rend = rendByPatente.get(row.patente)
    if (row.monto > montoMedio * MONTO_MEDIO_ALERT_MULTIPLIER && rend && rend.rendimiento > 0 && rend.atipico) {
      alerts.push({
        type: "gasto_rendimiento_bajo", severity: "high", entityLabel: row.patente,
        reason: `Gasto de ${Math.round(row.monto).toLocaleString("es-CL")} CLP con rendimiento atípicamente bajo (${rend.rendimiento.toFixed(1)}).`,
        action: "Revisar posibles fugas, mal uso o necesidad de mantención.",
        linkQuery: `patente=${encodeURIComponent(row.patente)}`,
      })
    }
  }

  // Muchas transacciones en el período.
  for (const row of byPatente.filter((r) => r.transacciones >= TRANSACCIONES_ALTAS).slice(0, TRANSACCIONES_ALTAS_ALERT_COUNT)) {
    alerts.push({
      type: "transacciones_altas", severity: "low", entityLabel: row.patente,
      reason: `${row.transacciones} transacciones registradas en el período.`,
      action: "Verificar si corresponde a operación real o cargas fraccionadas innecesarias.",
      linkQuery: `patente=${encodeURIComponent(row.patente)}`,
    })
  }

  // Rendimiento promedio igual a cero.
  for (const row of rendimientoPorPatente.filter((r) => r.rendimiento === 0).slice(0, RENDIMIENTO_CERO_ALERT_COUNT)) {
    alerts.push({
      type: "rendimiento_cero", severity: "medium", entityLabel: row.patente,
      reason: "No registra rendimiento promedio en el período (dato ausente o cero).",
      action: "Confirmar si el vehículo reportó rendimiento en el reporte de origen.",
      linkQuery: `patente=${encodeURIComponent(row.patente)}`,
    })
  }

  // Patentes sin vehículo/equipo asociado.
  if (input.patentesSinAsociacion > 0) {
    alerts.push({
      type: "sin_asociacion", severity: "medium", entityLabel: `${input.patentesSinAsociacion} patente(s)`,
      reason: "Hay patentes importadas que no coinciden con ningún vehículo registrado.",
      action: "Vincular manualmente cada patente a su vehículo desde el detalle del lote.",
      linkQuery: "asociacion=no",
    })
  }

  // Variación fuerte respecto al período anterior.
  if (input.variacionMontoPct != null && Math.abs(input.variacionMontoPct) >= VARIACION_FUERTE_PCT) {
    alerts.push({
      type: "variacion_fuerte", severity: input.variacionMontoPct > 0 ? "high" : "low", entityLabel: "Gasto total",
      reason: `El gasto varió ${input.variacionMontoPct > 0 ? "+" : ""}${input.variacionMontoPct}% respecto al período anterior.`,
      action: "Comparar con el detalle del período anterior antes de tomar decisiones presupuestarias.",
      linkQuery: "",
    })
  }

  return alerts
}

/**
 * Servicio de datos del dashboard de consumos de combustible por patente.
 * Centraliza KPIs, series y alertas para que la page.tsx solo arme la UI.
 */

import type { Session } from "next-auth"
import { sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords } from "@/db/schema"
import { buildConsumptionWhere, type ConsumptionFilters } from "./consumption-queries"
import { calcVariacion } from "./consumption-calculations"
import { flagOutliers as flagOutliersGeneric } from "./performance-statistics"
import { previousPeriod, dateOnly, daysAgo } from "@/lib/services/analytics-module/helpers"

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

const VARIACION_FUERTE_PCT = 30
const TRANSACCIONES_ALTAS = 30

export function normalizeConsumptionFilters(input: ConsumptionFilters, now: Date = new Date()) {
  return {
    fromDate: input.fromDate ?? daysAgo(now, 30),
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

  const topPatentesPorConsumo = [...byPatente].sort((a, b) => b.cantidad - a.cantidad).slice(0, 10)
  const topPatentesPorGasto = [...byPatente].sort((a, b) => b.monto - a.monto).slice(0, 10)
  const transaccionesPorPatente = [...byPatente].sort((a, b) => b.transacciones - a.transacciones).slice(0, 10)

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
    rendimientoPorPatente: rendimientoPorPatente.sort((a, b) => b.cantidad - a.cantidad).slice(0, 15),
    alerts,
  }
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

  // Consumo inusualmente alto (top 3 por consumo, si hay suficientes patentes para que "top" signifique algo).
  if (byPatente.length >= 4) {
    for (const row of [...byPatente].sort((a, b) => b.cantidad - a.cantidad).slice(0, 3)) {
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
    if (row.monto > montoMedio * 1.5 && rend && rend.rendimiento > 0 && rend.atipico) {
      alerts.push({
        type: "gasto_rendimiento_bajo", severity: "high", entityLabel: row.patente,
        reason: `Gasto de ${Math.round(row.monto).toLocaleString("es-CL")} CLP con rendimiento atípicamente bajo (${rend.rendimiento.toFixed(1)}).`,
        action: "Revisar posibles fugas, mal uso o necesidad de mantención.",
        linkQuery: `patente=${encodeURIComponent(row.patente)}`,
      })
    }
  }

  // Muchas transacciones en el período.
  for (const row of byPatente.filter((r) => r.transacciones >= TRANSACCIONES_ALTAS).slice(0, 3)) {
    alerts.push({
      type: "transacciones_altas", severity: "low", entityLabel: row.patente,
      reason: `${row.transacciones} transacciones registradas en el período.`,
      action: "Verificar si corresponde a operación real o cargas fraccionadas innecesarias.",
      linkQuery: `patente=${encodeURIComponent(row.patente)}`,
    })
  }

  // Rendimiento promedio igual a cero.
  for (const row of rendimientoPorPatente.filter((r) => r.rendimiento === 0).slice(0, 5)) {
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

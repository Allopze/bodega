import { Drop, CurrencyCircleDollar, Gauge, ArrowsClockwise, Car, ChartLineUp, WarningDiamond } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/app/(app)/analitica/analytics-kpi-card"
import { formatCLP, formatQty } from "@/lib/utils"
import type { ConsumptionDashboardData } from "@/lib/combustibles/consumption-dashboard"

export function ConsumptionKpis({ kpis }: { kpis: ConsumptionDashboardData["kpis"] }) {
  return (
    <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Indicadores de consumo de combustible">
      <KpiCard
        icon={<Drop size={18} />}
        label="Total consumido"
        value={formatQty(Math.round(kpis.totalCantidad), "L")}
        detail={`${formatQty(kpis.totalTarjetas)} tarjetas activas`}
        trend={kpis.variacionCantidadPct}
        tone={kpis.variacionCantidadPct != null && kpis.variacionCantidadPct >= 30 ? "signal" : "neutral"}
      />
      <KpiCard
        icon={<CurrencyCircleDollar size={18} />}
        label="Monto total"
        value={formatCLP(kpis.totalMonto)}
        detail="Gasto del período filtrado"
        trend={kpis.variacionMontoPct}
        tone={kpis.variacionMontoPct != null && kpis.variacionMontoPct >= 30 ? "signal" : "neutral"}
      />
      <KpiCard
        icon={<Gauge size={18} />}
        label="Precio promedio"
        value={kpis.precioPromedioUnidad != null ? `${formatCLP(kpis.precioPromedioUnidad)}/L` : "—"}
        detail="Monto / cantidad consumida"
        glossary="Precio promedio por unidad = monto total dividido por cantidad total consumida en el período."
      />
      <KpiCard
        icon={<ArrowsClockwise size={18} />}
        label="Transacciones"
        value={formatQty(kpis.totalTransacciones)}
        detail="Cargas registradas en el período"
      />
      <KpiCard
        icon={<Car size={18} />}
        label="Patentes únicas"
        value={formatQty(kpis.patentesUnicas)}
        detail="Vehículos/equipos con consumo"
      />
      <KpiCard
        icon={<ChartLineUp size={18} />}
        label="Rendimiento promedio"
        value={kpis.rendimientoPromedioPonderado > 0 ? kpis.rendimientoPromedioPonderado.toFixed(2) : "—"}
        detail="Ponderado por cantidad consumida"
        glossary="Promedio ponderado: Σ(rendimiento × cantidad) / Σ cantidad, para que las patentes con más consumo pesen más en el promedio."
      />
      <KpiCard
        icon={<WarningDiamond size={18} />}
        label="Sin asociación"
        value={formatQty(kpis.patentesSinAsociacion)}
        detail="Patentes sin vehículo vinculado"
        tone={kpis.patentesSinAsociacion > 0 ? "signal" : "neutral"}
      />
    </section>
  )
}

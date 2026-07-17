import { Drop, CurrencyCircleDollar, ArrowsClockwise, WarningDiamond } from "@phosphor-icons/react/dist/ssr"
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
        icon={<ArrowsClockwise size={18} />}
        label="Transacciones"
        value={formatQty(kpis.totalTransacciones)}
        detail="Cargas registradas en el período"
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

/** Métricas secundarias: acompañan el análisis sin competir con las 4 decisiones del resumen. */
export function ConsumptionAnalysisMetrics({ kpis }: { kpis: ConsumptionDashboardData["kpis"] }) {
  const rendimiento = kpis.rendimientoPromedioPonderado > 0 ? kpis.rendimientoPromedioPonderado.toFixed(2) : "—"
  const precio = kpis.precioPromedioUnidad != null ? `${formatCLP(kpis.precioPromedioUnidad)}/L` : "—"

  return (
    <dl className="mb-7 flex flex-wrap gap-x-6 gap-y-2 border-y border-[var(--color-border)] py-3 text-sm">
      <div className="flex items-baseline gap-2">
        <dt className="text-[var(--color-text-muted)]">Precio promedio</dt>
        <dd className="font-mono font-semibold tabular-nums">{precio}</dd>
      </div>
      <div className="flex items-baseline gap-2">
        <dt className="text-[var(--color-text-muted)]">Patentes únicas</dt>
        <dd className="font-mono font-semibold tabular-nums">{formatQty(kpis.patentesUnicas)}</dd>
      </div>
      <div className="flex items-baseline gap-2">
        <dt className="text-[var(--color-text-muted)]" title="Promedio ponderado por cantidad consumida">Rendimiento promedio</dt>
        <dd className="font-mono font-semibold tabular-nums">{rendimiento}</dd>
      </div>
    </dl>
  )
}

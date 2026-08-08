import { Drop, CurrencyCircleDollar, ArrowsClockwise, WarningDiamond } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/app/(app)/analitica/analytics-kpi-card"
import { formatCLP, formatQty } from "@/lib/utils"
import type { ConsumptionDashboardData } from "@/lib/combustibles/consumption-dashboard"

export function ConsumptionKpis({ kpis, hrefs }: {
  kpis: ConsumptionDashboardData["kpis"]
  /** Enlaces a la vista de Registros (con los filtros vigentes) que respalda cada cifra. */
  hrefs?: { registros?: string; sinAsociacion?: string }
}) {
  return (
    <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Indicadores de consumo de combustible">
      {/* Consumir y gastar más NO es buena noticia: sin declarar la polaridad,
          el tile pintaba un alza de gasto con badge verde de éxito, y además
          contradecía al panel de canales de arriba, que ya la pinta en ámbar. */}
      <KpiCard
        icon={<Drop size={18} />}
        label="Total consumido"
        value={formatQty(Math.round(kpis.totalCantidad), "L")}
        detail={`${formatQty(kpis.totalTarjetas)} tarjetas activas`}
        trend={kpis.variacionCantidadPct}
        trendPolarity="up-bad"
        tone={kpis.variacionCantidadPct != null && kpis.variacionCantidadPct >= 30 ? "signal" : "neutral"}
        href={hrefs?.registros}
      />
      <KpiCard
        icon={<CurrencyCircleDollar size={18} />}
        label="Monto total"
        value={formatCLP(kpis.totalMonto)}
        detail="Gasto del período filtrado"
        trend={kpis.variacionMontoPct}
        trendPolarity="up-bad"
        tone={kpis.variacionMontoPct != null && kpis.variacionMontoPct >= 30 ? "signal" : "neutral"}
        href={hrefs?.registros}
      />
      <KpiCard
        icon={<ArrowsClockwise size={18} />}
        label="Transacciones"
        value={formatQty(kpis.totalTransacciones)}
        detail="Cargas registradas en el período"
        href={hrefs?.registros}
      />
      <KpiCard
        icon={<WarningDiamond size={18} />}
        label="Sin asociación"
        value={formatQty(kpis.patentesSinAsociacion)}
        detail="Patentes sin vehículo vinculado"
        tone={kpis.patentesSinAsociacion > 0 ? "signal" : "neutral"}
        href={hrefs?.sinAsociacion}
      />
    </section>
  )
}

/** Métricas secundarias: acompañan el análisis sin competir con las 4 decisiones del resumen. */
export function ConsumptionAnalysisMetrics({ kpis }: { kpis: ConsumptionDashboardData["kpis"] }) {
  // `toFixed` rinde el punto decimal inglés en una interfaz que en todas las
  // demás cifras usa coma (es-CL).
  const rendimiento = kpis.rendimientoPromedioPonderado > 0
    ? kpis.rendimientoPromedioPonderado.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—"
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

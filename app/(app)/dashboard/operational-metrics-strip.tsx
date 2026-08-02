import {
  CheckCircle,
  CheckSquare,
  Package,
  ShoppingCart,
  Truck,
  WarningCircle,
  Warehouse,
} from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import type { DashboardMetric } from "./dashboard-control-center"

const METRIC_ICON = {
  tasks:      CheckCircle,
  critical:   WarningCircle,
  approvals:  CheckSquare,
  receipts:   Truck,
  deliveries: Warehouse,
  stock:      Package,
  investment: ShoppingCart,
  rate:       CheckCircle,
} as const

/**
 * Las cuatro ranuras semánticas del tope de la página.
 *
 * Usa `KpiCard`, el tile del design system. Tenía su propio `MetricCell` —la
 * tercera implementación de tarjeta de métrica del repo, junto a `KpiCard` y
 * `SummaryBar` (G-07)—; se absorbió pasándole a `KpiCard` lo único que le
 * faltaba: `sparkline` y el tono `danger`.
 *
 * El cambio se hizo al construir las cinco secciones por dominio: con seis filas
 * de KPI en la página, la que se veía distinta era ésta. Antes era la única y la
 * inconsistencia no se notaba.
 *
 * Deja de ser `"use client"`: no tiene estado ni handlers, sólo enlaces.
 */
export function OperationalMetricsStrip({ metrics }: { metrics: DashboardMetric[] }) {
  if (metrics.length === 0) return null

  return (
    <section className="min-w-0" aria-labelledby="indicadores-operacionales">
      <div className="mb-3 flex items-center justify-between border-b border-[var(--color-border)] pb-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" />
          <h2 id="indicadores-operacionales" className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
            Indicadores Operacionales
          </h2>
        </div>
        <span className="text-[11px] font-medium text-[var(--color-text-faint)]">Selecciona para ver el detalle</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = METRIC_ICON[metric.icon] ?? CheckCircle
          return (
            <KpiCard
              key={metric.key}
              icon={<Icon size={16} />}
              label={metric.label}
              value={String(metric.value)}
              detail={metric.description}
              tone={metric.tone}
              href={metric.href}
              sparkline={metric.sparkline}
            />
          )
        })}
      </div>
    </section>
  )
}

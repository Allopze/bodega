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
 * El panorama: una cifra por ranura semántica (dinero · cumplimiento · riesgo).
 *
 * Todos los tiles pesan lo mismo. Hasta la ronda UI/UX 2026-10-05 el primero
 * iba relleno en verde profundo (`HeroKpiCard`) y, como la primera ranura es
 * dinero, la página abría con "Inversión $0" como ancla visual (INI-06). La
 * urgencia vive ahora en el bloque "Hoy", que va antes; acá no hay jerarquía
 * que imponer entre tres cifras de ejes distintos.
 *
 * Usa `KpiCard`, el tile del design system. Tenía su propio `MetricCell` —la
 * tercera implementación de tarjeta de métrica del repo, junto a `KpiCard` y
 * `SummaryBar` (G-07)—; se absorbió pasándole a `KpiCard` lo único que le
 * faltaba: `sparkline` y el tono `danger`.
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
        <span className="text-xs font-medium text-[var(--color-text-muted)]">Selecciona para ver el detalle</span>
      </div>

      {/* `auto-fit` y no `xl:grid-cols-4`: con tres tiles (o dos, según el
          permiso) una rejilla de cuatro columnas dejaba un hueco a la derecha. */}
      <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        {metrics.map((metric) => {
          const Icon = METRIC_ICON[metric.icon] ?? CheckCircle
          return (
            <KpiCard
              key={metric.key}
              icon={<Icon size={16} />}
              label={metric.label}
              value={String(metric.value)}
              detail={metric.description}
              glossary={metric.glossary}
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

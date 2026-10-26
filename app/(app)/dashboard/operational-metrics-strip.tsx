import {
  CheckCircle,
  CheckSquare,
  Package,
  ShoppingCart,
  Truck,
  WarningCircle,
  Warehouse,
} from "@phosphor-icons/react/dist/ssr"
import { DashboardPanel } from "@/components/ui/dashboard-panel"
import { KpiCard } from "@/components/ui/kpi-card"
import type { DashboardMetric } from "./dashboard-control-center"
import { DASHBOARD_KPI } from "./dashboard-domain-shell"

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
 * Columnas del panel según cuántos tiles quedan (las ranuras sin permiso se
 * ceden, así que pueden ser 1, 2, 3 o 4).
 *
 * `DashboardPanel cols="kpis"` está pensado para cuatro: con tres dejaba un
 * hueco a la derecha y con dos, la mitad vacía. La rejilla interna es el hijo
 * `div` del panel, de ahí el selector `[&>div]`; su especificidad gana a las
 * columnas por defecto. Con tres, apilados hasta `lg` (como el mockup, que a
 * menos de 1100 px pasa cada tile a fila completa) y tres columnas desde ahí.
 */
const PANEL_COLUMNS: Record<number, string | undefined> = {
  1: "[&>div]:sm:grid-cols-1 [&>div]:xl:grid-cols-1",
  2: "[&>div]:xl:grid-cols-2",
  3: "[&>div]:sm:grid-cols-1 [&>div]:lg:grid-cols-3",
}

/**
 * El panorama: una cifra por ranura semántica (dinero · cumplimiento · riesgo).
 *
 * Todos los tiles pesan lo mismo. Hasta la ronda UI/UX 2026-10-05 el primero
 * iba relleno en verde profundo (`HeroKpiCard`) y, como la primera ranura es
 * dinero, la página abría con "Inversión $0" como ancla visual (INI-06). La
 * urgencia vive ahora en el bloque "Hoy", que va antes; acá no hay jerarquía
 * que imponer entre tres cifras de ejes distintos.
 *
 * Usa `KpiCard`, el tile del design system, en su variante del tablero
 * (`DASHBOARD_KPI`: celda plana de un panel único, cifras sans). Tenía su propio
 * `MetricCell` —la tercera implementación de tarjeta de métrica del repo, junto
 * a `KpiCard` y `SummaryBar` (G-07)—; se absorbió pasándole a `KpiCard` lo único
 * que le faltaba: `sparkline` y el tono `danger`.
 *
 * Las variaciones (`trend*`) y el estado vacío (`empty`) vienen de quien arma la
 * métrica; acá sólo se transmiten. Un tile sin comparación real no dibuja
 * ninguna: la variación no se inventa.
 *
 * Deja de ser `"use client"`: no tiene estado ni handlers, sólo enlaces.
 */
export function OperationalMetricsStrip({ metrics }: { metrics: DashboardMetric[] }) {
  if (metrics.length === 0) return null

  return (
    <section className="min-w-0" aria-labelledby="indicadores-operacionales">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="indicadores-operacionales" className="text-eyebrow">
          Indicadores Operacionales
        </h2>
        <span className="hidden text-xs text-[var(--color-text-muted)] sm:inline">Selecciona una cifra para ver el detalle</span>
      </div>

      <DashboardPanel cols="kpis" className={PANEL_COLUMNS[metrics.length]}>
        {metrics.map((metric) => {
          const Icon = METRIC_ICON[metric.icon] ?? CheckCircle
          return (
            <KpiCard
              key={metric.key}
              {...DASHBOARD_KPI}
              icon={<Icon size={16} />}
              label={metric.label}
              value={String(metric.value)}
              detail={metric.description}
              glossary={metric.glossary}
              tone={metric.tone}
              href={metric.href}
              sparkline={metric.sparkline}
              trend={metric.trend}
              trendPolarity={metric.trendPolarity}
              trendFormat={metric.trendFormat}
              trendLabel={metric.trendLabel}
              empty={metric.empty}
            />
          )
        })}
      </DashboardPanel>
    </section>
  )
}

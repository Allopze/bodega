"use client"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"

/**
 * Carga diferida de **todos** los gráficos de las secciones por dominio.
 *
 * Recharts pesa ~168 kB y ya se coló una vez en el chunk inicial del Centro de
 * Control por un import estático (UIUX-002: 1281 kB → 816 kB al arreglarlo).
 * Con ~13 gráficos repartidos en cinco secciones la tentación es peor, así que
 * **nada de `dashboard-charts.tsx` se importa estáticamente desde acá**: todo
 * pasa por `next/dynamic` con `ssr: false`.
 *
 * Cada uno va además envuelto en `ChartErrorBoundary`: con esta cantidad, un
 * gráfico que reviente no puede tumbar la página entera.
 */

function chartSkeleton(heightClass: string) {
  return function ChartSkeleton() {
    return (
      <div className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs animate-pulse ${heightClass}`}>
        <div className="mb-3 h-3 w-40 rounded bg-[var(--color-surface-2)]" />
        <div className="h-[calc(100%-2rem)] w-full rounded bg-[var(--color-surface-2)]" />
      </div>
    )
  }
}

const options = { ssr: false } as const

/** Difiere el gráfico y lo aísla tras un error boundary con su nombre. */
function lazyChart<P extends object>(
  load: () => Promise<ComponentType<P>>,
  chartName: string,
  height = "h-64",
): ComponentType<P> {
  const Chart = dynamic(load, { ...options, loading: chartSkeleton(height) })
  return function BoundedChart(props: P) {
    return (
      <ChartErrorBoundary chartName={chartName}>
        <Chart {...props} />
      </ChartErrorBoundary>
    )
  }
}

export const OperationalTrendChart = lazyChart(() => import("./dashboard-charts").then((m) => m.OperationalTrendChart), "la tendencia operativa")
export const ModuleWorkloadChart = lazyChart(() => import("./dashboard-charts").then((m) => m.ModuleWorkloadChart), "la distribución por módulo")
export const WorksiteActivityChart = lazyChart(() => import("./dashboard-charts").then((m) => m.WorksiteActivityChart), "la inversión por faena", "h-72")
export const SstTrendChart = lazyChart(() => import("./dashboard-charts").then((m) => m.SstTrendChart), "las tasas de siniestralidad")
export const SstAccidentChart = lazyChart(() => import("./dashboard-charts").then((m) => m.SstAccidentChart), "los accidentes por estado")
export const MaterialEnvironmentalChart = lazyChart(() => import("./dashboard-charts").then((m) => m.MaterialEnvironmentalChart), "los eventos materiales y ambientales")
export const FuelConsumptionChart = lazyChart(() => import("./dashboard-charts").then((m) => m.FuelConsumptionChart), "el consumo de combustible")
export const MaintenanceTrendChart = lazyChart(() => import("./dashboard-charts").then((m) => m.MaintenanceTrendChart), "la mantención de flota")
export const CompositionDonutChart = lazyChart(() => import("./dashboard-charts").then((m) => m.CompositionDonutChart), "la composición")
export const ThresholdRankingChart = lazyChart(() => import("./dashboard-charts").then((m) => m.ThresholdRankingChart), "el ranking")
export const StatusShareBar = lazyChart(() => import("./dashboard-charts").then((m) => m.StatusShareBar), "el reparto por estado", "h-28")
export const BillingFlowChart = lazyChart(() => import("./dashboard-charts").then((m) => m.BillingFlowChart), "el flujo de facturación", "h-80")
export const RadialGaugeChart = lazyChart(() => import("./dashboard-charts").then((m) => m.RadialGaugeChart), "el medidor de cumplimiento", "h-64")

"use client"
import { Skeleton } from "@/components/ui/skeleton"

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

/**
 * Esqueleto sin superficie: va dentro de un `ChartSlot` (el panel pone borde,
 * fondo y radio). Conserva el `p-5` que `ChartFrame` aplica al gráfico real,
 * para que al llegar el chunk el contenido no salte de lugar.
 */
function chartSkeleton(heightClass: string) {
  return function ChartSkeleton() {
    return (
      // `data-chart-loading`: las pruebas esperan a que no quede ninguno antes de
      // medir celdas vacías; un skeleton todavía no sabe si su gráfico tiene datos.
      <div data-chart-loading="" className={`flex flex-col p-5 ${heightClass}`}>
        <Skeleton className="mb-3 h-3 w-40" />
        <Skeleton className="w-full flex-1" />
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

export const OperationalTrendChart = lazyChart(() => import("./dashboard-charts").then((m) => m.OperationalTrendChart), "la tendencia operativa", "h-[25rem]")
export const SstTrendChart = lazyChart(() => import("./dashboard-charts").then((m) => m.SstTrendChart), "las tasas de siniestralidad", "h-[22rem]")
export const SstAccidentChart = lazyChart(() => import("./dashboard-charts").then((m) => m.SstAccidentChart), "los accidentes por estado", "h-96")
export const MaterialEnvironmentalChart = lazyChart(() => import("./dashboard-charts").then((m) => m.MaterialEnvironmentalChart), "los eventos materiales y ambientales", "h-[22rem]")
export const FuelConsumptionChart = lazyChart(() => import("./dashboard-charts").then((m) => m.FuelConsumptionChart), "el consumo de combustible", "h-96")
export const MaintenanceTrendChart = lazyChart(() => import("./dashboard-charts").then((m) => m.MaintenanceTrendChart), "la mantención de flota", "h-96")
export const CompositionDonutChart = lazyChart(() => import("./dashboard-charts").then((m) => m.CompositionDonutChart), "la composición", "h-80")
export const StatusShareBar = lazyChart(() => import("./dashboard-charts").then((m) => m.StatusShareBar), "el reparto por estado", "h-40")
export const BillingFlowChart = lazyChart(() => import("./dashboard-charts").then((m) => m.BillingFlowChart), "el flujo de facturación", "h-[25rem]")

"use client"
import { Skeleton } from "@/components/ui/skeleton"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"
import type { PerformanceGroup } from "@/lib/combustibles/equipment-performance"
import type { HistogramBin } from "@/lib/combustibles/performance-statistics"

type PerformanceGroupChartType = ComponentType<{
  groups: PerformanceGroup[]
  drilldownHref: (group: PerformanceGroup) => string
}>
type HistogramChartType = ComponentType<{ bins: HistogramBin[]; mean: number; unitLabel: string }>

/** Reserva el alto del gráfico para que la carga diferida no desplace el análisis. */
function AnalysisChartSkeleton() {
  return (
    <div className="flex h-72 items-end gap-2 border border-[var(--color-border)] bg-[var(--color-surface-2)] p-5" role="status" aria-label="Cargando gráfico de análisis">
      <span className="sr-only">Cargando gráfico de análisis</span>
      {[42, 68, 54, 82, 64, 90, 72, 48].map((height, index) => (
        <Skeleton
          key={height}
          className="flex-1"
          style={{ height: `${height}%`, animationDelay: `${index * 70}ms` }}
        />
      ))}
    </div>
  )
}

// `ssr: false` vive en este módulo cliente: evita entregar Recharts con el
// payload inicial de la ruta y deja un estado de carga equivalente al gráfico.
export const PerformanceGroupChart = dynamic(
  () => import("./performance-charts").then((module) => module.PerformanceGroupChart),
  { ssr: false, loading: AnalysisChartSkeleton },
) as PerformanceGroupChartType

export const HistogramChart = dynamic(
  () => import("./histogram-chart").then((module) => module.HistogramChart),
  { ssr: false, loading: AnalysisChartSkeleton },
) as HistogramChartType

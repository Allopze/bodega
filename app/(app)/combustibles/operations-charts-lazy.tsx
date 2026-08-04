"use client"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"
import type { ScatterPoint } from "@/lib/combustibles/operations-dashboard"
import type { VehicleEvolutionPoint } from "@/lib/combustibles/consumption-dashboard"

type ScatterChartType = ComponentType<{ points: ScatterPoint[] }>
type EvolutionByVehicleChartType = ComponentType<{ points: VehicleEvolutionPoint[]; maxSeries?: number }>

/** Mantiene la altura de los gráficos de operaciones mientras llega Recharts. */
function OperationsChartSkeleton() {
  return (
    <div className="flex h-80 items-end gap-2 border border-[var(--color-border)] bg-[var(--color-surface-2)] p-5" role="status" aria-label="Cargando gráfico de operaciones">
      <span className="sr-only">Cargando gráfico de operaciones</span>
      {[42, 68, 54, 82, 64, 90, 72, 48].map((height, index) => (
        <span
          key={height}
          className="flex-1 animate-pulse bg-[var(--color-border-strong)]"
          style={{ height: `${height}%`, animationDelay: `${index * 70}ms` }}
        />
      ))}
    </div>
  )
}

export const LitersVsKmChart = dynamic(
  () => import("./scatter-charts").then((module) => module.LitersVsKmChart),
  { ssr: false, loading: OperationsChartSkeleton },
) as ScatterChartType

export const LitersVsHourMeterChart = dynamic(
  () => import("./scatter-charts").then((module) => module.LitersVsHourMeterChart),
  { ssr: false, loading: OperationsChartSkeleton },
) as ScatterChartType

export const EvolutionByVehicleChart = dynamic(
  () => import("./evolution-by-vehicle-chart").then((module) => module.EvolutionByVehicleChart),
  { ssr: false, loading: OperationsChartSkeleton },
) as EvolutionByVehicleChartType

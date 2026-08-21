"use client"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"
import type { PeriodoRow, PatenteRankingRow, RendimientoRow } from "@/lib/combustibles/consumption-dashboard"

type EvolutionChartType = ComponentType<{ data: PeriodoRow[]; showCosts?: boolean }>
type PriceEvolutionChartType = ComponentType<{ data: PeriodoRow[] }>
type PatenteRankingChartType = ComponentType<{
  data: PatenteRankingRow[]
  metric: "cantidad" | "monto" | "transacciones"
}>
type RendimientoChartType = ComponentType<{ data: RendimientoRow[]; unitLabel?: string }>

function ChartSkeleton() {
  return (
    <div className="flex h-64 items-end gap-2 border border-[var(--color-border)] bg-[var(--color-surface-2)] p-5" role="status" aria-label="Cargando gráfico">
      <span className="sr-only">Cargando gráfico</span>
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

export const EvolutionChart = dynamic(
  () => import("./consumption-charts").then((module) => module.EvolutionChart),
  { ssr: false, loading: ChartSkeleton },
) as EvolutionChartType

export const PriceEvolutionChart = dynamic(
  () => import("./consumption-charts").then((module) => module.PriceEvolutionChart),
  { ssr: false, loading: ChartSkeleton },
) as PriceEvolutionChartType

export const PatenteRankingChart = dynamic(
  () => import("./consumption-charts").then((module) => module.PatenteRankingChart),
  { ssr: false, loading: ChartSkeleton },
) as PatenteRankingChartType

export const RendimientoChart = dynamic(
  () => import("./consumption-charts").then((module) => module.RendimientoChart),
  { ssr: false, loading: ChartSkeleton },
) as RendimientoChartType

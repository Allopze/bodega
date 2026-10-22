"use client"

import dynamic from "next/dynamic"
import { createElement, type ComponentType } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import type { MonthlyMediumChartData } from "@/lib/combustibles/control/view-helpers"
import type { PerformanceUnit } from "@/lib/combustibles/control/contracts"
import type { MeterChartPoint } from "./overview-meter-chart"
import type { RankingItem } from "./overview-ranking-chart"

/**
 * Carga diferida de los gráficos de la vista general: Recharts no viaja con el
 * payload inicial de la ruta (`ssr: false` solo puede declararse en un módulo
 * cliente). El esqueleto reserva el alto para que el gráfico no desplace la tabla.
 */
function chartSkeleton(height: string) {
  return function ChartSkeleton() {
    return createElement(Skeleton, { className: `${height} w-full`, role: "status", "aria-label": "Cargando gráfico" })
  }
}

export const OverviewMonthlyChart = dynamic(
  () => import("./overview-monthly-chart").then((module) => module.OverviewMonthlyChart),
  { ssr: false, loading: chartSkeleton("h-72") },
) as ComponentType<{ data: MonthlyMediumChartData }>

export const OverviewMeterChart = dynamic(
  () => import("./overview-meter-chart").then((module) => module.OverviewMeterChart),
  { ssr: false, loading: chartSkeleton("h-64") },
) as ComponentType<{ unit: PerformanceUnit; points: MeterChartPoint[] }>

export const OverviewRankingChart = dynamic(
  () => import("./overview-ranking-chart").then((module) => module.OverviewRankingChart),
  { ssr: false, loading: chartSkeleton("h-40") },
) as ComponentType<{ items: RankingItem[]; unitLabel: string }>

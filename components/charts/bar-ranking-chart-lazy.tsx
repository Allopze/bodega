"use client"

import { lazyChart } from "@/components/charts/lazy-chart"
import type { BarRankingChartProps } from "@/components/charts/bar-ranking-chart"

/**
 * `BarRankingChart` diferido (recharts fuera del chunk inicial, ver `lazy-chart.tsx`). Es lo que
 * importan los tableros desde un componente de servidor; las props son serializables.
 */
export const BarRankingChartLazy = lazyChart<BarRankingChartProps>(
  () => import("@/components/charts/bar-ranking-chart").then((module) => module.BarRankingChart),
  "Ranking",
  "h-48",
)

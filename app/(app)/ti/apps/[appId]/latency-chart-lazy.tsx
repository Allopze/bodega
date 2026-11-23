"use client"

import { lazyChart } from "@/components/charts/lazy-chart"
import type { LatencyChartProps } from "./latency-chart"

/** `LatencyChart` diferido: recharts queda fuera del chunk inicial (ver `components/charts/lazy-chart.tsx`). */
export const LatencyChartLazy = lazyChart<LatencyChartProps>(
  () => import("./latency-chart").then((module) => module.LatencyChart),
  "la demora de llegada",
  "h-64",
)

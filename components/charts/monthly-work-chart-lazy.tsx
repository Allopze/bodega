"use client"

import { lazyChart } from "./lazy-chart"
import type { MonthlyWorkChartProps } from "./monthly-work-chart"

/** Recharts pesa ~168 kB: este gráfico sólo se carga cuando la pestaña lo muestra. */
export const MonthlyWorkChartLazy = lazyChart<MonthlyWorkChartProps>(
  () => import("./monthly-work-chart").then((module) => module.MonthlyWorkChart),
  "Trabajos correctivos por mes",
  "h-60",
)

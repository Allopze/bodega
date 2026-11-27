"use client"

import { lazyChart } from "./lazy-chart"
import type { MonthlyComplianceChartProps } from "./monthly-compliance-chart"

/** Recharts pesa ~168 kB: este gráfico sólo se carga cuando la pestaña lo muestra. */
export const MonthlyComplianceChartLazy = lazyChart<MonthlyComplianceChartProps>(
  () => import("./monthly-compliance-chart").then((module) => module.MonthlyComplianceChart),
  "Cumplimiento por mes",
  "h-60",
)

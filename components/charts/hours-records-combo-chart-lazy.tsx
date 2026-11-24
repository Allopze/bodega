"use client"

import { lazyChart } from "./lazy-chart"
import type { HoursRecordsComboChartProps } from "./hours-records-combo-chart"

/** Recharts pesa ~168 kB: este gráfico sólo se carga cuando la pestaña lo muestra. */
export const HoursRecordsComboChartLazy = lazyChart<HoursRecordsComboChartProps>(
  () => import("./hours-records-combo-chart").then((module) => module.HoursRecordsComboChart),
  "Horas y registros por equipo",
  "h-72",
)

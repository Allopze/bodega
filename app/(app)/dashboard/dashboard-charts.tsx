"use client"

/**
 * Punto único de entrada de los gráficos del tablero.
 *
 * Los gráficos viven por familia en `./charts/`; este archivo sólo los
 * reexporta para que `lazyChart` (`dashboard-domain-charts.tsx`) siga cargando
 * recharts en un chunk diferido (UIUX-002) y los tests sigan importando desde
 * aquí.
 */
export { OperationalTrendChart, BillingFlowChart, billingPeriodLabel } from "./charts/trend-charts"
export { SstTrendChart, SstAccidentChart, MaterialEnvironmentalChart } from "./charts/sst-charts"
export type { SstMonthlyPoint, MaterialEnvironmentalPoint } from "./charts/sst-charts"
export { FuelConsumptionChart, MaintenanceTrendChart } from "./charts/fleet-charts"
export type { FuelMonthlyChartPoint, MaintenanceMonthlyChartPoint } from "./charts/fleet-charts"
export { CompositionDonutChart, StatusShareBar } from "./charts/composition-charts"
export type { CompositionSlice, StatusShare } from "./charts/composition-charts"
export { ModuleWorkloadChart, WorksiteActivityChart, ThresholdRankingChart } from "./charts/ranking-charts"
export type { ModuleWorkloadPoint, ThresholdBar } from "./charts/ranking-charts"
export { RadialGaugeChart } from "./charts/radial-gauge"

"use client"

/**
 * Punto único de entrada de los gráficos del tablero.
 *
 * Los gráficos viven por familia en `./charts/`; este archivo sólo los
 * reexporta para que `lazyChart` (`dashboard-domain-charts.tsx`) siga cargando
 * recharts en un chunk diferido (UIUX-002) y los tests sigan importando desde
 * aquí.
 */
export { OperationalTrendChart } from "./charts/trend-charts"
// Facturado y cobrado se reutiliza en `/facturacion`, así que vive en `components/charts/` (CHART-036).
export { BillingFlowChart } from "@/components/charts/billing-flow-chart"
export { billingPeriodLabel } from "@/lib/services/billing/summary-charts"
export { SstTrendChart, SstAccidentChart, MaterialEnvironmentalChart } from "./charts/sst-charts"
export type { SstMonthlyPoint, MaterialEnvironmentalPoint } from "./charts/sst-charts"
export { FuelConsumptionChart } from "./charts/fleet-charts"
export type { FuelMonthlyChartPoint } from "./charts/fleet-charts"
export { CompositionDonutChart, StatusShareBar } from "./charts/composition-charts"
export type { CompositionSlice, StatusShare } from "./charts/composition-charts"

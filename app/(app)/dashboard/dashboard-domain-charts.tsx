"use client"

import { lazyChart } from "@/components/charts/lazy-chart"

/**
 * Carga diferida de **todos** los gráficos de las secciones por dominio: nada de
 * `dashboard-charts.tsx` se importa estáticamente desde acá (ver
 * `components/charts/lazy-chart.tsx`, que comparten los Indicadores de Control
 * operacional).
 */

export const OperationalTrendChart = lazyChart(() => import("./dashboard-charts").then((m) => m.OperationalTrendChart), "la tendencia operativa", "h-[25rem]")
export const SstTrendChart = lazyChart(() => import("./dashboard-charts").then((m) => m.SstTrendChart), "las tasas de siniestralidad", "h-[22rem]")
export const SstAccidentChart = lazyChart(() => import("./dashboard-charts").then((m) => m.SstAccidentChart), "los accidentes por estado", "h-96")
export const MaterialEnvironmentalChart = lazyChart(() => import("./dashboard-charts").then((m) => m.MaterialEnvironmentalChart), "los eventos materiales y ambientales", "h-[22rem]")
export const FuelConsumptionChart = lazyChart(() => import("./dashboard-charts").then((m) => m.FuelConsumptionChart), "el consumo de combustible", "h-96")
export const CompositionDonutChart = lazyChart(() => import("./dashboard-charts").then((m) => m.CompositionDonutChart), "la composición", "h-80")
export const StatusShareBar = lazyChart(() => import("./dashboard-charts").then((m) => m.StatusShareBar), "el reparto por estado", "h-40")
export const BillingFlowChart = lazyChart(() => import("./dashboard-charts").then((m) => m.BillingFlowChart), "el flujo de facturación", "h-[25rem]")

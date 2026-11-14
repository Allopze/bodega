"use client"

import { lazyChart } from "@/components/charts/lazy-chart"

/**
 * Carga diferida de **todos** los gráficos de los Indicadores de mantención: nada de
 * `indicators-charts.tsx` (recharts) se importa estáticamente desde la página (ver
 * `components/charts/lazy-chart.tsx`).
 */

export const WorkOrderFlowChart = lazyChart(() => import("./indicators-charts").then((m) => m.WorkOrderFlowChart), "las órdenes de trabajo por período", "h-[25rem]")
export const WorkOrderMixChart = lazyChart(() => import("./indicators-charts").then((m) => m.WorkOrderMixChart), "la mezcla de reparación y mantención", "h-96")
export const RecordsKindChart = lazyChart(() => import("./indicators-charts").then((m) => m.RecordsKindChart), "los registros preventivos y correctivos", "h-96")
export const OutOfServiceChart = lazyChart(() => import("./indicators-charts").then((m) => m.OutOfServiceChart), "los días fuera de servicio", "h-96")

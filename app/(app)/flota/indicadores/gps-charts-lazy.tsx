"use client"

import { lazyChart } from "@/components/charts/lazy-chart"

/**
 * Carga diferida de los gráficos de los Indicadores GPS: nada de `gps-charts.tsx`
 * (y por tanto recharts) se importa estáticamente desde la página.
 */

export const GpsUsageChart = lazyChart(() => import("./gps-charts").then((m) => m.GpsUsageChart), "los km y horas de motor", "h-[26rem]")
export const GpsIdleChart = lazyChart(() => import("./gps-charts").then((m) => m.GpsIdleChart), "las horas de trabajo y ralentí", "h-[26rem]")
export const GpsTripsChart = lazyChart(() => import("./gps-charts").then((m) => m.GpsTripsChart), "los viajes", "h-[26rem]")
export const GpsAlertsChart = lazyChart(() => import("./gps-charts").then((m) => m.GpsAlertsChart), "las alertas de conducción", "h-[26rem]")

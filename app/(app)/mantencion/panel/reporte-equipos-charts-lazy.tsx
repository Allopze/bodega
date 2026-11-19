"use client"

import { lazyChart } from "@/components/charts/lazy-chart"

/**
 * Carga diferida de los gráficos de «Reportes de equipos»: nada de `reporte-equipos-charts.tsx`
 * (recharts) se importa estáticamente desde la página (ver `components/charts/lazy-chart.tsx`).
 */

export const ReportsPerDayChart = lazyChart(() => import("./reporte-equipos-charts").then((m) => m.ReportsPerDayChart), "los reportes de equipos por día", "h-96")
export const OpenFailuresAgeChart = lazyChart(() => import("./reporte-equipos-charts").then((m) => m.OpenFailuresAgeChart), "las fallas abiertas por equipo", "h-48")

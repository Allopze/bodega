"use client"

import { lazyChart } from "@/components/charts/lazy-chart"

/**
 * Carga diferida de **todos** los gráficos de «Indicadores de combustible»: ninguno se
 * importa estáticamente (Recharts no viaja en el JS inicial de la ruta; ver
 * `components/charts/lazy-chart.tsx`). Los tres últimos son los gráficos de Consumo
 * tal cual: la pantalla los reutiliza, no los duplica.
 */

export const LitersCostChart = lazyChart(() => import("./indicators-charts").then((m) => m.LitersCostChart), "los litros y el costo por mes", "h-96")

export const LitersByMediumChart = lazyChart(
  () => import("../consumo/_components/charts/overview-monthly-chart").then((m) => m.OverviewMonthlyChart),
  "los litros por medio de suministro",
  "h-80",
)

export const MeterRateChart = lazyChart(
  () => import("../consumo/_components/charts/meter-rate-chart").then((m) => m.MeterRateChart),
  "el rendimiento por mes",
  "h-72",
)

export const IdleLitersChart = lazyChart(
  () => import("../consumo/_components/charts/idle-liters-chart").then((m) => m.IdleLitersChart),
  "los litros en vacío por mes",
  "h-80",
)

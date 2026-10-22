"use client"

import dynamic from "next/dynamic"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { Skeleton } from "@/components/ui/skeleton"
import type { IdleDailyPoint } from "./idle-daily-chart"
import type { IdleLitersPoint } from "./idle-liters-chart"
import type { IdleMonthlyPoint } from "./idle-monthly-chart"

/** Recharts pesa: se descarga solo cuando la vista de ralentí llega al navegador (patrón de `fuel-charts-lazy`). */
const Loading = () => <Skeleton className="h-72 w-full" />

const MonthlyChart = dynamic(() => import("./idle-monthly-chart").then((m) => m.IdleMonthlyChart), { ssr: false, loading: Loading })
const LitersChart = dynamic(() => import("./idle-liters-chart").then((m) => m.IdleLitersChart), { ssr: false, loading: Loading })
const DailyChart = dynamic(() => import("./idle-daily-chart").then((m) => m.IdleDailyChart), { ssr: false, loading: Loading })

export function IdleMonthlyChartLazy({ data }: { data: IdleMonthlyPoint[] }) {
  return <ChartErrorBoundary chartName="Horas por mes"><MonthlyChart data={data} /></ChartErrorBoundary>
}

export function IdleLitersChartLazy({ data }: { data: IdleLitersPoint[] }) {
  return <ChartErrorBoundary chartName="Litros en vacío por mes"><LitersChart data={data} /></ChartErrorBoundary>
}

export function IdleDailyChartLazy({ data }: { data: IdleDailyPoint[] }) {
  return <ChartErrorBoundary chartName="Horas por día"><DailyChart data={data} /></ChartErrorBoundary>
}

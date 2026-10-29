"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import type { WeeklyPoint } from "./weekly-chart-inner"

export type { WeeklyPoint } from "./weekly-chart-inner"

/**
 * Recharts pesa y sólo corre en el navegador: el import dinámico real saca la
 * librería del paquete inicial de la página (mismo patrón que `/ti`).
 */
export const WeeklyChart = dynamic<{ data: WeeklyPoint[] }>(() => import("./weekly-chart-inner").then((module) => module.WeeklyChartInner), {
  ssr: false,
  loading: () => <Skeleton className="h-60 w-full rounded-xl" aria-hidden />,
})

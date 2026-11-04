"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import type { BalanceSeries } from "@/lib/bodega/balance-series"

/**
 * Recharts pesa y sólo corre en el navegador: el import dinámico lo saca del
 * paquete inicial de Bodega (mismo patrón que el gráfico semanal de «Por revisar»).
 */
export const StockBalanceChart = dynamic<{ series: BalanceSeries }>(
  () => import("./stock-balance-chart").then((module) => module.StockBalanceChart),
  { ssr: false, loading: () => <Skeleton className="h-56 w-full" aria-hidden /> },
)

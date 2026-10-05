"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import type { TiChartsProps } from "./ti-charts-inner"

/**
 * Recharts pesa mucho y solo corre en cliente: el import dinámico real (el
 * módulo aparte, no un componente ya importado) saca la librería del paquete
 * inicial de /ti. `ssr: false` exige estar en un componente cliente.
 */
export const TiCharts = dynamic<TiChartsProps>(() => import("./ti-charts-inner"), {
  ssr: false,
  loading: () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-hidden>
      <Skeleton className="h-72 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  ),
})

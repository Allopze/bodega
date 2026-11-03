"use client"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { Skeleton } from "@/components/ui/skeleton"
import type { BillingFlowChartProps } from "@/components/charts/billing-flow-chart"

/**
 * Carga diferida de «Facturado y cobrado» en `/facturacion`.
 *
 * La página es un Server Component y recharts pesa ~168 kB: un import estático
 * lo metería en el chunk inicial de la ruta (UIUX-002 lo midió en el tablero).
 * `ssr: false` sólo se admite en un módulo cliente, de ahí este archivo aparte;
 * el esqueleto conserva la altura del gráfico (`h-56` + la leyenda) para que al
 * llegar el chunk el contenido no salte.
 *
 * Va dentro de `ChartErrorBoundary`: si recharts revienta, la tarjeta dice que
 * no se pudo dibujar y «Ver datos» sigue entregando las mismas cifras.
 */
function BillingFlowSkeleton() {
  return (
    <div role="status" aria-label="Cargando gráfico" className="flex h-[17.5rem] flex-col gap-3">
      <span className="sr-only">Cargando gráfico</span>
      <Skeleton className="w-full flex-1" />
      <Skeleton className="h-6 w-40" />
    </div>
  )
}

const Chart = dynamic(
  () => import("@/components/charts/billing-flow-chart").then((module) => module.BillingFlowChart),
  { ssr: false, loading: BillingFlowSkeleton },
) as ComponentType<BillingFlowChartProps>

export function BillingFlowChartLazy(props: BillingFlowChartProps) {
  return (
    <ChartErrorBoundary chartName="el flujo de facturación">
      <Chart {...props} />
    </ChartErrorBoundary>
  )
}

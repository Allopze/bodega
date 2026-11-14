"use client"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Carga diferida de un gráfico dentro de un `ChartSlot`.
 *
 * Recharts pesa ~168 kB y ya se coló una vez en el chunk inicial del Centro de
 * Control por un import estático (UIUX-002: 1281 kB → 816 kB al arreglarlo).
 * Por eso los tableros (Inicio y los Indicadores de Control operacional) no
 * importan ningún gráfico estáticamente: todo pasa por `next/dynamic` con
 * `ssr: false`, envuelto además en `ChartErrorBoundary` para que un gráfico que
 * reviente no tumbe la página entera.
 */

/**
 * Esqueleto sin superficie: va dentro de un `ChartSlot` (el panel pone borde,
 * fondo y radio). Conserva el `p-5` que `ChartFrame` aplica al gráfico real,
 * para que al llegar el chunk el contenido no salte de lugar.
 */
function chartSkeleton(heightClass: string) {
  return function ChartSkeleton() {
    return (
      // `data-chart-loading`: las pruebas esperan a que no quede ninguno antes de
      // medir celdas vacías; un skeleton todavía no sabe si su gráfico tiene datos.
      <div data-chart-loading="" className={`flex flex-col p-5 ${heightClass}`}>
        <Skeleton className="mb-3 h-3 w-40" />
        <Skeleton className="w-full flex-1" />
      </div>
    )
  }
}

const options = { ssr: false } as const

/** Difiere el gráfico y lo aísla tras un error boundary con su nombre. */
export function lazyChart<P extends object>(
  load: () => Promise<ComponentType<P>>,
  chartName: string,
  height = "h-64",
): ComponentType<P> {
  const Chart = dynamic(load, { ...options, loading: chartSkeleton(height) })
  return function BoundedChart(props: P) {
    return (
      <ChartErrorBoundary chartName={chartName}>
        <Chart {...props} />
      </ChartErrorBoundary>
    )
  }
}

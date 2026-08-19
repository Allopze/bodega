"use client"

import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"

export function WarehouseHeaderMetrics({
  worksiteCount,
  worksitesWithStock,
  productsWithStock,
  lowStockCount,
  warnStockCount,
  minStockDefinedCount,
  movementCount,
  movementWindowDays,
}: {
  worksiteCount: number
  worksitesWithStock: number
  productsWithStock: number
  lowStockCount: number
  /** Banda de advertencia de `getStockAlerts` (bajo 1,5× el mínimo). El
   *  dashboard ya avisaba de esto y Bodega sólo conocía el binario. */
  warnStockCount: number
  /** Líneas de stock con un mínimo definido (>0). Sin ninguna, "Bajo mínimo 0" no
   *  significa "todo sano" sino "nadie configuró umbrales": se muestra en gris. */
  minStockDefinedCount: number
  movementCount: number
  movementWindowDays: number
}) {
  const noThresholds = minStockDefinedCount === 0
  const stats: SummaryStat[] = [
    {
      key: "faenas",
      label: "Faenas con stock",
      value: `${worksitesWithStock}/${worksiteCount}`,
      href: "/bodega",
    },
    {
      key: "products",
      label: "Productos con stock",
      value: productsWithStock.toLocaleString("es-CL"),
      href: "/bodega",
    },
    {
      key: "low",
      label: "Bajo mínimo",
      value: noThresholds ? "—" : lowStockCount.toLocaleString("es-CL"),
      // Sin umbrales el KPI no puede decir nada, y el enlace lleva a definirlos
      // en vez de a una lista que siempre estaría vacía.
      hint: noThresholds
        ? "sin mínimos definidos"
        : warnStockCount > 0 ? `${warnStockCount} por agotarse` : undefined,
      tone: lowStockCount > 0 ? "signal" : undefined,
      href: noThresholds ? undefined : "/bodega?stock=low",
    },
    {
      key: "movements",
      // Era el total histórico: sólo crecía y no cambiaba ninguna decisión.
      label: `Movimientos · ${movementWindowDays} d`,
      value: movementCount.toLocaleString("es-CL"),
      href: "/bodega?vista=kardex",
    },
  ]

  return <SummaryBar stats={stats} compact />
}

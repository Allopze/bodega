"use client"

import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"

export function WarehouseHeaderMetrics({
  worksiteCount,
  worksitesWithStock,
  productsWithStock,
  lowStockCount,
  minStockDefinedCount,
  movementCount,
}: {
  worksiteCount: number
  worksitesWithStock: number
  productsWithStock: number
  lowStockCount: number
  /** Líneas de stock con un mínimo definido (>0). Sin ninguna, "Bajo mínimo 0" no
   *  significa "todo sano" sino "nadie configuró umbrales": se muestra en gris. */
  minStockDefinedCount: number
  movementCount: number
}) {
  const noThresholds = minStockDefinedCount === 0
  const stats: SummaryStat[] = [
    { key: "faenas",    label: "Faenas con stock",   value: `${worksitesWithStock}/${worksiteCount}` },
    { key: "products",  label: "Productos con stock", value: productsWithStock.toLocaleString("es-CL") },
    {
      key: "low",
      label: "Bajo mínimo",
      value: noThresholds ? "—" : lowStockCount.toLocaleString("es-CL"),
      hint: noThresholds ? "sin mínimos definidos" : undefined,
      tone: lowStockCount > 0 ? "signal" : undefined,
      href: noThresholds ? undefined : "/bodega?stock=low",
    },
    { key: "movements", label: "Movimientos",        value: movementCount.toLocaleString("es-CL") },
  ]

  return <SummaryBar stats={stats} compact />
}

"use client"

import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"

export function WarehouseHeaderMetrics({
  worksiteCount,
  worksitesWithStock,
  productsWithStock,
  lowStockCount,
  movementCount,
}: {
  worksiteCount: number
  worksitesWithStock: number
  productsWithStock: number
  lowStockCount: number
  movementCount: number
}) {
  const stats: SummaryStat[] = [
    { key: "faenas",    label: "Faenas con stock",  value: `${worksitesWithStock}/${worksiteCount}` },
    { key: "products",  label: "Productos activos", value: productsWithStock.toLocaleString("es-CL") },
    { key: "low",       label: "Bajo mínimo",       value: lowStockCount.toLocaleString("es-CL"), tone: lowStockCount > 0 ? "signal" : undefined },
    { key: "movements", label: "Movimientos",       value: movementCount.toLocaleString("es-CL") },
  ]

  return <SummaryBar stats={stats} compact />
}

"use client"

import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"

export function WarehouseHeaderMetrics({
  scopeParam = "",
  worksiteCount,
  worksitesWithStock,
  productsWithStock,
  movementCount,
  movementWindowDays,
}: {
  /** Alcance de faena en pantalla, ya serializado ("" = el de por defecto).
   *  Los KPI enlazan dentro de lo que muestran: sin esto saltarían a la bodega
   *  propia aunque el número contara otra faena. */
  scopeParam?: string
  worksiteCount: number
  worksitesWithStock: number
  productsWithStock: number
  movementCount: number
  movementWindowDays: number
}) {
  const href = (extra?: string) => {
    const qs = [scopeParam, extra].filter(Boolean).join("&")
    return qs ? `/bodega?${qs}` : "/bodega"
  }
  const stats: SummaryStat[] = [
    // Con una sola faena a la vista el "1/1" no informa nada.
    ...(worksiteCount > 1 ? [{
      key: "faenas",
      label: "Faenas con stock",
      value: `${worksitesWithStock}/${worksiteCount}`,
      href: href(),
    }] : []),
    {
      key: "products",
      label: "Productos con stock",
      value: productsWithStock.toLocaleString("es-CL"),
      href: href(),
    },
    {
      key: "movements",
      // Era el total histórico: sólo crecía y no cambiaba ninguna decisión.
      label: `Movimientos · ${movementWindowDays} d`,
      value: movementCount.toLocaleString("es-CL"),
      href: href("vista=kardex"),
    },
  ]

  return <SummaryBar stats={stats} compact />
}

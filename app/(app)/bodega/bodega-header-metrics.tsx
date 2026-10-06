"use client"

import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"

export function WarehouseHeaderMetrics({
  scopeParam = "",
  worksiteCount,
  worksitesWithStock,
  productsWithStock,
  movementCount,
  movementWindowDays,
  movementSince,
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
  /** Primer día de la ventana (YYYY-MM-DD): el KPI lleva a los movimientos desde esa fecha. */
  movementSince?: string
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
    }] : []),
    {
      key: "products",
      label: "Productos con stock",
      // Sin enlace: llevaba a esta misma pantalla y repetía el subtítulo de la
      // tabla (A5), una cifra con dos controles.
      value: productsWithStock.toLocaleString("es-CL"),
    },
    {
      key: "movements",
      // Era el total histórico: sólo crecía y no cambiaba ninguna decisión.
      label: `Movimientos · ${movementWindowDays} d`,
      value: movementCount.toLocaleString("es-CL"),
      // La cifra cuenta una ventana de días: el destino tiene que mostrar esa
      // misma ventana, no el historial completo (mostraba 70 donde decía 6).
      href: href(["vista=kardex", movementSince ? `desde=${movementSince}` : ""].filter(Boolean).join("&")),
    },
  ]

  return <SummaryBar stats={stats} compact />
}

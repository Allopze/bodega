"use client"

import { useSearchParams } from "next/navigation"
import { ExportLink } from "@/components/ui/export-button"

/**
 * "Exportar Excel" respetando los filtros activos de la URL.
 *
 * Existe para que la acción viva en el mismo lugar en todas las listas de
 * Adquisiciones: compras y solicitudes la tenían en el top bar y recepción
 * dentro de la fila de filtros (auditoría UI/UX 2026-07-29, A-18). Lee los
 * parámetros del cliente, así que el enlace sigue reflejando lo que se ve.
 */
export function ExportExcelButton({ tipo }: { tipo: string }) {
  const searchParams = useSearchParams()
  const params = new URLSearchParams({ tipo })
  for (const [from, to] of [["q", "q"], ["estado", "status"], ["faena", "faena"], ["proveedor", "proveedor"]]) {
    const value = searchParams.get(from!)
    if (value) params.set(to!, value)
  }

  // Mismo botón, ícono y jerarquía que el resto de las exportaciones (UX-08).
  return <ExportLink href={`/api/reportes/export?${params.toString()}`} />
}

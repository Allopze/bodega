"use client"

import { useSearchParams } from "next/navigation"
import { DownloadSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"

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

  return (
    <Button variant="secondary" size="sm" asChild>
      <a href={`/api/reportes/export?${params.toString()}`} download>
        <DownloadSimple size={15} />
        Exportar Excel
      </a>
    </Button>
  )
}

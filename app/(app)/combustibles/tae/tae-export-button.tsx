"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportTaeSubmissionsXlsxAction } from "./actions"
import type { TaeExportFilters } from "./actions"

/**
 * Exporta los registros en terreno con las columnas propias del formulario (punto
 * de carga, fuente de la lectura, identidad manual). En «Cargas a equipos» sólo
 * lo ve quien tiene `tae_export` pero no `export`: para el resto, la exportación
 * de la lista ya incluye estos registros.
 */
export function TaeExportButton({ filters, label = "Exportar Excel", ariaLabel }: { filters?: TaeExportFilters; label?: string; ariaLabel?: string }) {
  return <ExportButton action={exportTaeSubmissionsXlsxAction} filters={filters} label={label} ariaLabel={ariaLabel} />
}

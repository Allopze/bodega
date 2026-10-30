"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportRecordAction } from "./actions"

/**
 * «Exportar a Excel» de un solo registro: una descarga ligera junto al PDF, sin competir con la acción
 * principal. El rótulo visible es corto («Excel») porque el encabezado ya lleva cinco acciones y la miga
 * se cortaba; el nombre accesible conserva el verbo.
 */
export function RecordExportButton({ recordId }: { recordId: string }) {
  return <ExportButton action={() => exportRecordAction({ recordId })} label="Excel" ariaLabel="Exportar a Excel" variant="ghost" />
}

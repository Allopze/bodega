"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportRecordsAction } from "./actions"

/** «Exportar a Excel» de la lista: manda los filtros de la URL y el servidor los vuelve a leer. */
export function RecordsExportButton({ params }: { params: Record<string, string> }) {
  return <ExportButton action={() => exportRecordsAction(params)} label="Exportar a Excel" />
}

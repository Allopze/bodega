"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportHistoryAction } from "./actions"

/** «Exportar Excel» del Historial: manda los filtros de la URL y el servidor los vuelve a leer. */
export function HistoryExportButton({ params }: { params: Record<string, string> }) {
  return <ExportButton action={() => exportHistoryAction(params)} />
}

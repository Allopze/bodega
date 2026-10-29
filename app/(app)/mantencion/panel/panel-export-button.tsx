"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportPanelAction } from "./actions"

export function PanelExportButton({ params }: { params: Record<string, string> }) {
  return <ExportButton action={() => exportPanelAction(params)} label="Exportar a Excel" />
}

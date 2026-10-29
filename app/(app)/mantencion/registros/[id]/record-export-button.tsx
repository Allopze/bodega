"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportRecordAction } from "./actions"

/** «Exportar a Excel» de un solo registro. */
export function RecordExportButton({ recordId }: { recordId: string }) {
  return <ExportButton action={() => exportRecordAction({ recordId })} label="Exportar a Excel" />
}

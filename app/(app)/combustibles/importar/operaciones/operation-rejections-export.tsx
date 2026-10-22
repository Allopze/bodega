"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportOperationRejectionsAction } from "../../actions-operaciones"

export function OperationRejectionsExport({ batchId }: { batchId: string }) {
  return <ExportButton action={exportOperationRejectionsAction} filters={batchId} label="Descargar rechazadas (Excel)" />
}

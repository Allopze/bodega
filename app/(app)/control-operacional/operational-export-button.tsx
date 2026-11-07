"use client"

import { ExportButton } from "@/components/ui/export-button"
import type { OperationalControlPeriod } from "@/lib/services/operational-control"
import { exportOperationalControlXlsxAction } from "./actions"

export function OperationalExportButton({ period }: { period: OperationalControlPeriod }) {
  // Rótulo estándar «Exportar Excel» (auditoría UX-08): era «Exportar reporte».
  return <ExportButton action={exportOperationalControlXlsxAction} filters={period} />
}

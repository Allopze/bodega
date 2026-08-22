"use client"

import { ExportButton } from "@/components/ui/export-button"
import type { OperationalControlPeriod } from "@/lib/services/operational-control"
import { exportOperationalControlXlsxAction } from "./actions"

export function OperationalExportButton({ period }: { period: OperationalControlPeriod }) {
  return <ExportButton action={exportOperationalControlXlsxAction} filters={period} label="Exportar reporte" />
}

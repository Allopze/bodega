"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportMaintenanceXlsxAction } from "./actions"

export function MaintenanceExportButton({
  filters,
}: {
  filters: { vehicleId?: string; worksiteId?: string; status?: string; q?: string }
}) {
  return <ExportButton action={exportMaintenanceXlsxAction} filters={filters} />
}

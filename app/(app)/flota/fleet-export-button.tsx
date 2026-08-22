"use client"

import { ExportButton } from "@/components/ui/export-button"
import type { FleetOverviewFilters } from "@/lib/fleet-overview-filters"
import { exportFleetXlsxAction } from "./actions"

export function FleetExportButton({ filters }: { filters: FleetOverviewFilters }) {
  return <ExportButton action={exportFleetXlsxAction} filters={filters} />
}

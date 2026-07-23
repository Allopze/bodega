"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportTaeSubmissionsXlsxAction } from "./actions"
import type { TaeExportFilters } from "./actions"

export function TaeExportButton({ filters }: { filters?: TaeExportFilters }) {
  return <ExportButton action={exportTaeSubmissionsXlsxAction} filters={filters} />
}

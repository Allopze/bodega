"use client"

import * as React from "react"
import { ExportButton } from "@/components/ui/export-button"
import type { TaeCopecFilters } from "@/lib/combustibles/tae-copec-reconciliation"
import { exportTaeCopecReconciliationAction } from "./actions"

export function TaeCopecExportButton({ filters }: { filters: TaeCopecFilters }) {
  return <ExportButton action={exportTaeCopecReconciliationAction} filters={filters} />
}

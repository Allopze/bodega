"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportFuelLoadsXlsxAction } from "./actions"

interface ExportButtonProps {
  filters?: Record<string, string | undefined>
}

export function ExportXlsxButton({ filters }: ExportButtonProps) {
  return <ExportButton action={exportFuelLoadsXlsxAction} filters={filters} />
}

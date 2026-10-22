"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportIdleXlsxAction } from "./export-actions"

export function IdleExportButton({ query }: { query: string }) {
  return <ExportButton action={exportIdleXlsxAction} filters={{ query }} />
}

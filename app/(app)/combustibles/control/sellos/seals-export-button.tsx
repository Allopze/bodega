"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportSealsXlsxAction } from "./export-actions"

export function SealsExportButton({ query }: { query: string }) {
  return <ExportButton action={exportSealsXlsxAction} filters={{ query }} />
}

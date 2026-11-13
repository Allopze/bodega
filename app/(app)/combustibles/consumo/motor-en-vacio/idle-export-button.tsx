"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportIdleXlsxAction } from "./export-actions"

export function IdleExportButton({ query }: { query: string }) {
  return <ExportButton action={exportIdleXlsxAction} filters={{ query }} label="Exportar Excel" ariaLabel="Exportar a Excel el motor en vacío por equipo y mes" />
}

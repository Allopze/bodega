"use client"

import * as React from "react"
import { ExportDialog } from "@/components/export-dialog"

interface WorksiteOption {
  id: string
  name: string
}

interface KardexExportButtonProps {
  worksites: WorksiteOption[]
  canExport: boolean
}

export function KardexExportButton({ worksites, canExport }: KardexExportButtonProps) {
  if (!canExport) return null

  return (
    <ExportDialog
      endpoint="/api/bodega/kardex/export"
      title="Exportar kardex"
      description="Descarga el historial de movimientos de inventario como archivo Excel. Puedes filtrar por faena."
      label="Excel"
      worksites={worksites}
      canExport={canExport}
    />
  )
}

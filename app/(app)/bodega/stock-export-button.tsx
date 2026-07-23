"use client"

import * as React from "react"
import { ExportDialog } from "@/components/export-dialog"

interface WorksiteOption {
  id: string
  name: string
}

interface StockExportButtonProps {
  worksites: WorksiteOption[]
  canExport: boolean
}

export function StockExportButton({ worksites, canExport }: StockExportButtonProps) {
  if (!canExport) return null

  return (
    <ExportDialog
      endpoint="/api/bodega/stock/export"
      title="Exportar stock"
      description="Descarga el inventario actual como archivo Excel. Puedes filtrar por faena."
      label="Excel"
      worksites={worksites}
      canExport={canExport}
    />
  )
}

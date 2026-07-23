"use client"

import * as React from "react"
import { ExportDialog } from "@/components/export-dialog"
import { ESTADO_PPA_LABELS } from "@/lib/ppa/badges"

interface WorksiteOption {
  id: string
  name: string
}

interface PpaExportButtonProps {
  worksites: WorksiteOption[]
  canExport: boolean
}

export function PpaExportButton({ worksites, canExport }: PpaExportButtonProps) {
  if (!canExport) return null

  const statusOptions = Object.entries(ESTADO_PPA_LABELS).map(([value, label]) => ({
    value,
    label,
  }))

  return (
    <ExportDialog
      endpoint="/api/prevencion/ppa/export"
      title="Exportar PPA Digital"
      description="Aplica filtros para reducir el volumen de datos exportados. Sin filtros se exportan todos los PPA visibles."
      label="Excel"
      worksites={worksites}
      statuses={statusOptions}
      canExport={canExport}
      paramNames={{
        worksite: "worksiteId",
        from: "dateFrom",
        to: "dateTo",
        status: "estado",
      }}
      isoDateISOFormat
    />
  )
}

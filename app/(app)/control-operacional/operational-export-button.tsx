"use client"

import { useMemo } from "react"
import { ExportButton } from "@/components/ui/export-button"
import type { OperationalControlPeriod } from "@/lib/services/operational-control"
import { exportOperationalControlXlsxAction } from "./actions"

/** `contractId`: el contrato elegido en la pantalla; el Excel filtra «Activos» igual que ella. */
export function OperationalExportButton({ period, contractId = null }: { period: OperationalControlPeriod; contractId?: string | null }) {
  // Estable entre renders: `ExportButton` recibe los filtros como dato, no una función nueva en cada render.
  const filters = useMemo(
    () => (contractId ? { from: period.from, to: period.to, contrato: contractId } : { from: period.from, to: period.to }),
    [period.from, period.to, contractId],
  )
  // Rótulo estándar «Exportar Excel» (auditoría UX-08): era «Exportar reporte».
  return <ExportButton action={exportOperationalControlXlsxAction} filters={filters} />
}

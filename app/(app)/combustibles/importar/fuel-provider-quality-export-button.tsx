"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportFuelProviderQualityAction } from "./fuel-provider-quality-export-action"

export function FuelProviderQualityExportButton() {
  return <ExportButton action={() => exportFuelProviderQualityAction()} label="Exportar pendientes y rechazos" />
}

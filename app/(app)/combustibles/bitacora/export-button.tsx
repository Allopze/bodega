"use client"

import { ExportButton } from "@/components/ui/export-button"
import { exportFuelLogAction, exportFuelLogSelectionAction } from "./actions"
import type { FuelLogFilters, FuelLogSource } from "@/lib/combustibles/fuel-log"

export function BitacoraExportButton({ filters }: { filters: FuelLogFilters }) {
  return <ExportButton action={() => exportFuelLogAction(filters)} />
}

export function BitacoraSelectionExport({ selection }: { selection: Array<{ source: FuelLogSource; id: string }> }) {
  return <ExportButton action={() => exportFuelLogSelectionAction(selection)} label="Exportar seleccionadas" />
}

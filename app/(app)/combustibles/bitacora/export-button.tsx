"use client"

import { ExportButton } from "@/components/ui/export-button"
import { TaeExportButton } from "../tae/tae-export-button"
import type { TaeExportFilters } from "../tae/actions"
import { exportFuelLogAction, exportFuelLogSelectionAction } from "./actions"
import type { FuelLogFilters, FuelLogSource } from "@/lib/combustibles/fuel-log"

/**
 * El botón de exportar de «Cargas a equipos», en la cabecera. Un solo botón que
 * cambia de rótulo según haya filas seleccionadas: «Exportar» baja todo lo que
 * muestran los filtros (con el período de arriba) y «Exportar (N seleccionadas)»
 * sólo esas filas. Ambos exigen `export`; quien sólo tiene `tae_export` baja los
 * registros en terreno con las columnas del formulario.
 */
export function CargasExportButton({
  filters,
  selection,
  canExport,
  taeFilters,
}: {
  filters: FuelLogFilters
  selection: Array<{ source: FuelLogSource; id: string }>
  canExport: boolean
  /** Sólo cuando la sesión tiene `tae_export` y no `export`. */
  taeFilters?: TaeExportFilters
}) {
  if (canExport && selection.length > 0) {
    const label = `Exportar (${selection.length} ${selection.length === 1 ? "seleccionada" : "seleccionadas"})`
    return <ExportButton action={() => exportFuelLogSelectionAction(selection)} label={label} ariaLabel={`${label} a Excel`} />
  }
  if (canExport) return <ExportButton action={() => exportFuelLogAction(filters)} label="Exportar" ariaLabel="Exportar a Excel" />
  if (taeFilters) return <TaeExportButton filters={taeFilters} label="Exportar" ariaLabel="Exportar los registros en terreno a Excel" />
  return null
}

"use client"

import { useSafeShellHeader } from "@/components/layout/header-context"
import { ExportButton } from "@/components/ui/export-button"
import { matchesEquipmentSearch, type EquipmentListRow } from "@/lib/services/mantencion/equipment-list"
import { exportEquipmentAction } from "@/app/(app)/mantencion/equipos/actions"

/**
 * «Exportar a Excel» de la lista: exporta los equipos que se ven, incluida la
 * búsqueda de la barra superior. Manda los ids visibles; el servidor vuelve a
 * cargarlos dentro del alcance de faenas de quien exporta, así que un id ajeno
 * no sale y la exportación nunca es más amplia que la pantalla.
 */
export function EquipmentExportButton({ rows, includeRetired, filterLabels }: { rows: EquipmentListRow[]; includeRetired: boolean; filterLabels: Record<string, string> }) {
  const { searchQuery } = useSafeShellHeader()
  const query = searchQuery.trim()
  const vehicleIds = rows.filter((row) => matchesEquipmentSearch(row, query)).map((row) => row.id)
  const filters: Record<string, string> = { ...filterLabels }
  if (query) filters["búsqueda"] = query
  return <ExportButton action={exportEquipmentAction} filters={{ vehicleIds, includeRetired, filters }} label="Exportar a Excel" />
}

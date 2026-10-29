"use server"

import { guardPermission } from "@/lib/auth/can"
import { exportPanel } from "@/lib/services/mantencion/export-panel"
import type { ExportOutcome } from "@/lib/services/mantencion/export-records"
import { parsePanelFilters } from "@/lib/services/mantencion/panel-filters"

/**
 * Excel del panel con el período y la faena de la pantalla. Vuelve a interpretar
 * los parámetros con `parsePanelFilters` y el servicio aplica el alcance del
 * usuario, así que pedir otra faena en la URL no abre datos ajenos.
 */
export async function exportPanelAction(params: Record<string, string>): Promise<ExportOutcome> {
  const guard = await guardPermission("mant:export", "/mantencion/panel")
  if (guard.error) return guard.error
  const safe = Object.fromEntries(Object.entries(params ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  return exportPanel({ session: guard.session, filters: parsePanelFilters(safe) })
}

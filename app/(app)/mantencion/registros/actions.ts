"use server"

import { guardPermission } from "@/lib/auth/can"
import { exportRecords, type ExportOutcome } from "@/lib/services/mantencion/export-records"
import { parseRecordFilters } from "@/lib/services/mantencion/records-filters"

/**
 * Excel de «Registros» con los filtros de la pantalla. El navegador manda los
 * parámetros de la URL tal cual; aquí se vuelven a interpretar con el mismo
 * `parseRecordFilters` de la lista —nunca se confía en filtros ya armados— y el
 * alcance del usuario lo pone el servicio. La bitácora la escribe el servicio.
 */
export async function exportRecordsAction(params: Record<string, string>): Promise<ExportOutcome> {
  const guard = await guardPermission("mant:export", "/mantencion/registros")
  if (guard.error) return guard.error
  const safe = Object.fromEntries(Object.entries(params ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  return exportRecords({ session: guard.session, filters: parseRecordFilters(safe) })
}

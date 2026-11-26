"use server"

import { revalidatePath } from "next/cache"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { can, guardPermission } from "@/lib/auth/can"
import { parseHistoryParams } from "@/lib/mantencion/history-view"
import { exportHistory } from "@/lib/services/mantencion/export-history"
import type { ExportOutcome } from "@/lib/services/mantencion/export-records"
import { commitHistoricalImport, linkHistoricalRecord, previewHistoricalImport, type HistoricalPreview, type HistoricalSummary } from "@/lib/services/mantencion/historical-import"
import { HISTORICAL_MAX_BYTES } from "@/lib/services/mantencion/historical-workbook"
import type { MantActionResult } from "@/lib/services/mantencion/result"
import { todayInChile } from "@/lib/utils"

const PATH = "/mantencion/registros/historicos"
async function authorize() {
  const guard = await guardPermission("mant:equipment:manage", PATH)
  if (guard.error) return guard
  if (!can(guard.session, "mant:records:view_all")) return { session: null, error: { ok: false as const, message: "No tienes permisos para importar el historial de todas las faenas." } }
  return guard
}
async function upload(form: FormData): Promise<{ ok: true; buffer: ArrayBuffer; name: string } | { ok: false; message: string }> {
  const file = form.get("file")
  if (!(file instanceof File) || !file.size || !/\.xlsx$/i.test(file.name)) return { ok: false, message: "Elige la exportación de Google Forms en formato Excel (.xlsx)." }
  if (file.size > HISTORICAL_MAX_BYTES) return { ok: false, message: "El archivo supera 5 MB." }
  return { ok: true, buffer: await file.arrayBuffer(), name: file.name }
}
export async function previewHistoricalAction(form: FormData): Promise<MantActionResult<HistoricalPreview>> {
  const guard = await authorize()
  if (guard.error) return guard.error
  const file = await upload(form)
  if (!file.ok) return file
  try { return await previewHistoricalImport(file.buffer, file.name) }
  catch (error) { return actionErrorResult(error, "No se pudo revisar el archivo.") }
}
export async function commitHistoricalAction(form: FormData): Promise<MantActionResult<HistoricalSummary>> {
  const guard = await authorize()
  if (guard.error) return guard.error
  const file = await upload(form)
  if (!file.ok) return file
  try {
    const result = await commitHistoricalImport({ userId: guard.session.user.id, email: guard.session.user.email ?? null }, file.buffer, file.name)
    if (result.ok) revalidatePath(PATH)
    return result
  } catch (error) { return actionErrorResult(error, "No se pudo importar. No se guardaron cambios.") }
}

export async function linkHistoricalAction(input: { sourceKey: string; vehicleId?: string; worksiteId?: string }): Promise<MantActionResult> {
  const guard = await authorize()
  if (guard.error) return guard.error
  if (typeof input?.sourceKey !== "string" || (input.vehicleId !== undefined && typeof input.vehicleId !== "string") || (input.worksiteId !== undefined && typeof input.worksiteId !== "string")) {
    return { ok: false, message: "No se reconocen los vínculos elegidos." }
  }
  try {
    const result = await linkHistoricalRecord({ userId: guard.session.user.id, email: guard.session.user.email ?? null }, input.sourceKey, input)
    if (result.ok) { revalidatePath(PATH); revalidatePath(`${PATH}/${input.sourceKey}`) }
    return result
  } catch (error) { return actionErrorResult(error, "No se pudieron guardar los vínculos.") }
}

/**
 * Excel del Historial de mantenciones con los filtros de la pantalla. El navegador manda los parámetros de la URL tal
 * cual; aquí se vuelven a interpretar con el mismo `parseHistoryParams` de la lista (nunca se confía en filtros ya
 * armados) y el alcance del usuario lo pone el servicio.
 */
export async function exportHistoryAction(params: Record<string, string>): Promise<ExportOutcome> {
  const guard = await guardPermission("mant:export", PATH)
  if (guard.error) return guard.error
  const safe = Object.fromEntries(Object.entries(params ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  try {
    return await exportHistory({ session: guard.session, params: parseHistoryParams(safe, todayInChile()) })
  } catch (error) { return actionErrorResult(error, "No se pudo exportar el historial.") }
}

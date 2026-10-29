"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { guardPermission } from "@/lib/auth/can"
import type { ExportActionResult } from "@/components/ui/export-button"
import { exportSchedules } from "@/lib/services/mantencion/export-schedules"
import type { MantActionResult } from "@/lib/services/mantencion/result"
import { createSchedule, deleteSchedule, parseIntervalList } from "@/lib/services/mantencion/schedules"
import type { ActionState } from "@/lib/validation/operations"

/**
 * Acciones de la lista de pautas: crear, eliminar y exportar. Todas piden
 * `mant:schedules:manage` EN el servidor (y `mant:export` para el Excel); las
 * ediciones del editor están en `[id]/actions.ts`.
 */

const PATH = "/mantencion/pautas"
const actor = (session: { user: { id: string; email?: string | null } }) => ({ userId: session.user.id, email: session.user.email ?? null })

function revalidateSchedules(scheduleId?: string) {
  revalidatePath(PATH)
  if (scheduleId) revalidatePath(`${PATH}/${scheduleId}`)
  revalidatePath("/mantencion/equipos")
}

export async function createScheduleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardPermission("mant:schedules:manage", PATH)
  if (guard.error) return guard.error
  const unit = String(formData.get("unit") ?? "")
  const intervals = parseIntervalList(String(formData.get("intervals") ?? ""))
  if (!intervals) {
    return { ok: false, message: "Escribe al menos un intervalo (números mayores que 0).", fieldErrors: { intervals: ["Escribe al menos un intervalo (números mayores que 0)."] } }
  }
  let id: string
  try {
    const result = await createSchedule(actor(guard.session), {
      name: String(formData.get("name") ?? "").slice(0, 200),
      unit: unit === "h" ? "h" : "km",
      intervals,
      copyFromId: String(formData.get("copyFromId") ?? "").trim().slice(0, 64) || null,
    })
    if (!result.ok) return { ok: false, message: result.message, fieldErrors: result.field ? { [result.field]: [result.message] } : undefined }
    id = result.data.id
  } catch (error) {
    return actionErrorResult(error, "No se pudo crear la pauta. Inténtalo de nuevo.")
  }
  revalidateSchedules(id)
  redirect(`${PATH}/${id}`)
}

export async function deleteScheduleAction(input: { scheduleId: string }): Promise<MantActionResult<{ released: number }>> {
  const guard = await guardPermission("mant:schedules:manage", PATH)
  if (guard.error) return guard.error
  const parsed = z.object({ scheduleId: z.string().trim().min(1).max(64) }).safeParse(input)
  if (!parsed.success) return { ok: false, message: "No se reconoce la pauta." }
  try {
    const result = await deleteSchedule(actor(guard.session), parsed.data.scheduleId)
    // No se revalida la ruta de la pauta borrada: el editor abierto mostraría un «no encontrada»
    // antes de que el cliente navegue a la lista.
    if (result.ok) revalidateSchedules()
    return result
  } catch (error) {
    return actionErrorResult(error, "No se pudo eliminar la pauta.")
  }
}

/** Excel de una pauta (la del editor) o de todas (la lista): una hoja por pauta. */
export async function exportSchedulesAction(input: { scheduleId?: string } = {}): Promise<ExportActionResult> {
  const guard = await guardPermission("mant:export", PATH)
  if (guard.error) return guard.error
  // Las pautas solo las ve quien las administra: exportar no abre más de lo que la pantalla muestra.
  const manage = await guardPermission("mant:schedules:manage", PATH)
  if (manage.error) return manage.error
  const parsed = z.object({ scheduleId: z.string().trim().min(1).max(64).optional() }).safeParse(input)
  if (!parsed.success) return { ok: false, message: "No se reconoce la pauta." }
  try {
    const { base64, filename } = await exportSchedules(guard.session, { scheduleIds: parsed.data.scheduleId ? [parsed.data.scheduleId] : null })
    return { ok: true, data: { base64, filename } }
  } catch (error) {
    return actionErrorResult(error, "No se pudo generar el Excel.")
  }
}

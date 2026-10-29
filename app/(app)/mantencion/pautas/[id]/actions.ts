"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { guardPermission } from "@/lib/auth/can"
import { assignEquipment, type AssignSummary } from "@/lib/services/mantencion/schedule-assign"
import {
  addScheduleInterval, addScheduleItem, clearIntervalReview, renameSchedule, setScheduleBrandRule, setScheduleCell,
  setScheduleIntervalActive, setScheduleItemActive, type ScheduleEditResult,
} from "@/lib/services/mantencion/schedule-editor"

/**
 * Ediciones del editor de pautas. Cada una pide `mant:schedules:manage` en el
 * servidor, valida la forma de lo que llega y delega en el servicio, que cierra
 * la edición publicando una versión (regla 15). Todas devuelven el resultado del
 * servicio tal cual (ya redactado en español) y revalidan la pauta y la lista.
 */

const PATH = "/mantencion/pautas"
const id = z.string().trim().min(1).max(64)
const actor = (session: { user: { id: string; email?: string | null } }) => ({ userId: session.user.id, email: session.user.email ?? null })

type Failure = { ok: false; message: string }
const FAILED = "No se pudo guardar el cambio. Inténtalo de nuevo."

async function edit<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  run: (data: z.infer<S>, who: ReturnType<typeof actor>) => Promise<ScheduleEditResult<T>>,
  extraRevalidate: string[] = [],
): Promise<ScheduleEditResult<T> | Failure> {
  const guard = await guardPermission("mant:schedules:manage", PATH)
  if (guard.error) return guard.error
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Los datos del cambio no son válidos. Recarga la página e inténtalo de nuevo." }
  try {
    const result = await run(parsed.data, actor(guard.session))
    if (result.ok) {
      const scheduleId = (parsed.data as { scheduleId: string }).scheduleId
      revalidatePath(`${PATH}/${scheduleId}`)
      revalidatePath(PATH)
      for (const path of extraRevalidate) revalidatePath(path)
    }
    return result
  } catch (error) {
    return actionErrorResult(error, FAILED)
  }
}

export async function renameScheduleAction(input: { scheduleId: string; name: string }) {
  return edit(z.object({ scheduleId: id, name: z.string().max(200) }), input, (d, who) => renameSchedule(who, d.scheduleId, d.name))
}

export async function setScheduleCellAction(input: { scheduleId: string; itemId: string; intervalId: string; applies: boolean }) {
  return edit(z.object({ scheduleId: id, itemId: id, intervalId: id, applies: z.boolean() }), input, (d, who) => setScheduleCell(who, d))
}

export async function addScheduleItemAction(input: { scheduleId: string; groupId?: string; groupName?: string; name: string }) {
  return edit(
    z.object({ scheduleId: id, groupId: id.optional(), groupName: z.string().max(120).optional(), name: z.string().max(200) }),
    input,
    (d, who) => addScheduleItem(who, d),
  )
}

export async function setScheduleItemActiveAction(input: { scheduleId: string; itemId: string; active: boolean }) {
  return edit(z.object({ scheduleId: id, itemId: id, active: z.boolean() }), input, (d, who) => setScheduleItemActive(who, d))
}

export async function addScheduleIntervalAction(input: { scheduleId: string; value: number }) {
  return edit(z.object({ scheduleId: id, value: z.number().int().positive().max(9_999_999) }), input, (d, who) => addScheduleInterval(who, d))
}

export async function setScheduleIntervalActiveAction(input: { scheduleId: string; intervalId: string; active: boolean }) {
  return edit(z.object({ scheduleId: id, intervalId: id, active: z.boolean() }), input, (d, who) => setScheduleIntervalActive(who, d))
}

export async function clearIntervalReviewAction(input: { scheduleId: string; intervalId?: string }) {
  return edit(z.object({ scheduleId: id, intervalId: id.optional() }), input, (d, who) => clearIntervalReview(who, d))
}

export async function setBrandRuleAction(input: { scheduleId: string; activity: string; brandId: string; value: "A" | "W" | "X" }) {
  return edit(
    z.object({ scheduleId: id, activity: z.string().min(1).max(300), brandId: id, value: z.enum(["A", "W", "X"]) }),
    input,
    (d, who) => setScheduleBrandRule(who, d),
  )
}

/** Deja `vehicleIds` como el conjunto de equipos con esta pauta; el servidor recalcula el resumen. */
export async function assignEquipmentAction(input: { scheduleId: string; vehicleIds: string[] }): Promise<
  { ok: true; message: string; data: AssignSummary } | { ok: false; message: string }
> {
  const guard = await guardPermission("mant:schedules:manage", PATH)
  if (guard.error) return guard.error
  const parsed = z.object({ scheduleId: id, vehicleIds: z.array(id).max(5000) }).safeParse(input)
  if (!parsed.success) return { ok: false, message: "La selección de equipos no es válida. Recarga la página e inténtalo de nuevo." }
  try {
    const result = await assignEquipment(actor(guard.session), parsed.data)
    if (result.ok) {
      revalidatePath(`${PATH}/${parsed.data.scheduleId}`)
      revalidatePath(PATH)
      revalidatePath("/mantencion/equipos")
      revalidatePath("/mantencion/panel")
    }
    return result
  } catch (error) {
    return actionErrorResult(error, "No se pudo guardar la asignación. No se cambió ningún equipo.")
  }
}

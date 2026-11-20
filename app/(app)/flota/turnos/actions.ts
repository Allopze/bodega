"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { guardPermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import {
  clearDayMark,
  createShift,
  setDayMark,
  setIdleTarget,
  updateShift,
  voidShift,
  type ShiftActor,
  type ShiftInput,
} from "@/lib/services/fleet-shifts"
import { isRouteOperational } from "@/lib/services/module-toggles"
import type { Session } from "next-auth"

/**
 * Acciones de «Turnos y ralentí». Todas piden `flota:manage_shifts` en el servidor, respetan el interruptor
 * del submódulo (apagado de fábrica: lo enciende un administrador), validan la forma de lo que llega y
 * delegan en el servicio, que aplica las reglas de negocio, el alcance por faena y la auditoría. Los
 * mensajes del servicio llegan tal cual (ya redactados en español).
 */

const PATH = "/flota/turnos"
const NOT_ENABLED = "Los turnos aún no están habilitados."
const INVALID = "Los datos no son válidos. Recarga la página e inténtalo de nuevo."

type Failure = { ok: false; message: string }
type SimpleResult = { ok: true } | Failure

const id = z.string().trim().min(1).max(64)
const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const hour = z.number().int().min(0).max(23)
const notes = z.string().max(2000)

const shiftInputSchema = z.object({
  vehicleId: id,
  shiftDate: plainDate,
  startHour: hour,
  endHour: hour,
  operatorWorkerId: id,
  notes,
})
const voidInputSchema = z.object({ shiftId: id, reason: z.string().max(2000) })
const dayMarkSchema = z.object({
  vehicleId: id,
  day: plainDate,
  reason: z.enum(["sin_operacion_programada", "otro"]),
  notes,
})
const clearDayMarkSchema = z.object({ vehicleId: id, day: plainDate })

function actorOf(session: Session): ShiftActor {
  return { userId: session.user.id, email: session.user.email ?? null, scope: serviceWorksiteScope(session) }
}

/** Permiso + interruptor del submódulo. El interruptor se lee ya autorizado: no revela nada a quien no puede. */
async function authorize(): Promise<{ session: Session; error: null } | { session: null; error: Failure }> {
  const guard = await guardPermission("flota:manage_shifts", PATH)
  if (guard.error) return guard
  if (!(await isRouteOperational(PATH))) return { session: null, error: { ok: false, message: NOT_ENABLED } }
  return guard
}

function failure(error: unknown, fallback: string): Failure {
  const result = actionErrorResult(error, fallback)
  return { ok: false, message: result.message }
}

export async function createShiftAction(input: ShiftInput): Promise<{ ok: true; shiftId: string } | Failure> {
  const guard = await authorize()
  if (guard.error) return guard.error
  const parsed = shiftInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: INVALID }
  try {
    const result = await createShift(actorOf(guard.session), parsed.data)
    if (result.ok) revalidatePath(PATH)
    return result
  } catch (error) {
    return failure(error, "No se pudo registrar el turno. Inténtalo de nuevo.")
  }
}

export async function updateShiftAction(shiftId: string, input: ShiftInput): Promise<{ ok: true; shiftId: string } | Failure> {
  const guard = await authorize()
  if (guard.error) return guard.error
  const parsedId = id.safeParse(shiftId)
  const parsed = shiftInputSchema.safeParse(input)
  if (!parsedId.success || !parsed.success) return { ok: false, message: INVALID }
  try {
    const result = await updateShift(actorOf(guard.session), parsedId.data, parsed.data)
    if (result.ok) revalidatePath(PATH)
    return result
  } catch (error) {
    return failure(error, "No se pudo guardar el turno. Inténtalo de nuevo.")
  }
}

export async function voidShiftAction(shiftId: string, reason: string): Promise<SimpleResult> {
  const guard = await authorize()
  if (guard.error) return guard.error
  const parsed = voidInputSchema.safeParse({ shiftId, reason })
  if (!parsed.success) return { ok: false, message: INVALID }
  try {
    const result = await voidShift(actorOf(guard.session), parsed.data.shiftId, parsed.data.reason)
    if (result.ok) revalidatePath(PATH)
    return result
  } catch (error) {
    return failure(error, "No se pudo anular el turno. Inténtalo de nuevo.")
  }
}

export async function setDayMarkAction(input: {
  vehicleId: string
  day: string
  reason: "sin_operacion_programada" | "otro"
  notes: string
}): Promise<SimpleResult> {
  const guard = await authorize()
  if (guard.error) return guard.error
  const parsed = dayMarkSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: INVALID }
  try {
    const result = await setDayMark(actorOf(guard.session), parsed.data)
    if (result.ok) revalidatePath(PATH)
    return result
  } catch (error) {
    return failure(error, "No se pudo guardar la marca del día. Inténtalo de nuevo.")
  }
}

export async function clearDayMarkAction(input: { vehicleId: string; day: string }): Promise<SimpleResult> {
  const guard = await authorize()
  if (guard.error) return guard.error
  const parsed = clearDayMarkSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: INVALID }
  try {
    const result = await clearDayMark(actorOf(guard.session), parsed.data)
    if (result.ok) revalidatePath(PATH)
    return result
  } catch (error) {
    return failure(error, "No se pudo quitar la marca del día. Inténtalo de nuevo.")
  }
}

export async function setIdleTargetAction(pct: number): Promise<SimpleResult> {
  const guard = await authorize()
  if (guard.error) return guard.error
  const parsed = z.number().int().min(1).max(99).safeParse(pct)
  if (!parsed.success) return { ok: false, message: "La meta debe ser un porcentaje entero entre 1 y 99." }
  try {
    const result = await setIdleTarget(actorOf(guard.session), parsed.data)
    if (result.ok) revalidatePath(PATH)
    return result
  } catch (error) {
    return failure(error, "No se pudo guardar la meta. Inténtalo de nuevo.")
  }
}

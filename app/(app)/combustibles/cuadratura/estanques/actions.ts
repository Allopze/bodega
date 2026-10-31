"use server"

import { safeActionMessage } from "@/lib/action-error"

import { isNetworkError } from "@/lib/network-error"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { chileLocalDateTimeToUtc } from "@/lib/utils"
import { createFuelCycleMovement, fuelCycleMovementSchema } from "@/lib/combustibles/fuel-cycle"
import { logger } from "@/lib/logger"
import type { ActionState } from "@/lib/validation/masters"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { revalidateFuel } from "@/lib/combustibles/revalidate"

function empty(value: FormDataEntryValue | null) { const text = String(value ?? "").trim(); return text || undefined }

/**
 * `DateTimePicker` entrega hora de pared sin zona ("2026-08-07T21:30"): es hora
 * de Chile, no del proceso ni UTC. Pegarle una "Z" corría el movimiento 3–4
 * horas (y de día en las cargas nocturnas); `new Date(valor)` la interpretaba en
 * la zona del servidor. `chileLocalDateTimeToUtc` aplica el desfase real de
 * Chile, horario de verano incluido.
 */
function toInstant(value: string | undefined) {
  if (!value || /[zZ]|[+-]\d{2}:\d{2}$/.test(value)) return value
  try { return chileLocalDateTimeToUtc(value) } catch { return value }
}

export async function createFuelCycleMovementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:create", FUEL_PATHS.cuadraturaEstanques) } catch { return { ok: false, message: "No tienes permisos para registrar movimientos" } }
  const raw = {
    eventType: empty(formData.get("eventType")), worksiteId: empty(formData.get("worksiteId")), productId: empty(formData.get("productId")),
    quantity: empty(formData.get("quantity")), occurredAt: toInstant(empty(formData.get("occurredAt"))), supplierId: empty(formData.get("supplierId")),
    sourceLocationId: empty(formData.get("sourceLocationId")), targetLocationId: empty(formData.get("targetLocationId")), vehicleId: empty(formData.get("vehicleId")),
    documentNumber: empty(formData.get("documentNumber")), notes: empty(formData.get("notes")),
  }
  const parsed = fuelCycleMovementSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos del movimiento" }
  if (!canAccessWorksite(session, parsed.data.worksiteId)) return { ok: false, message: "No puedes operar esta faena" }
  try {
    await createFuelCycleMovement(parsed.data, { userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidateFuel()
    return { ok: true, message: "Movimiento físico registrado" }
  } catch (error) {
    logger.error("[createFuelCycleMovementAction]", error)
    const message = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : safeActionMessage(error, "No se pudo registrar el movimiento")
    return { ok: false, message }
  }
}

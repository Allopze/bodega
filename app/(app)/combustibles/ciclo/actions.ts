"use server"

import { revalidatePath } from "next/cache"
import { isNetworkError } from "@/lib/network-error"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { createFuelCycleMovement, fuelCycleMovementSchema } from "@/lib/combustibles/fuel-cycle"
import { logger } from "@/lib/logger"
import type { ActionState } from "@/lib/validation/masters"

function empty(value: FormDataEntryValue | null) { const text = String(value ?? "").trim(); return text || undefined }

/**
 * `datetime-local` entrega hora de pared sin zona ("2026-08-07T21:30"). Pegarle
 * una "Z" la declaraba UTC y corría el movimiento 3–4 horas (y de día en las
 * cargas nocturnas). `new Date(valor)` sin offset se interpreta en la zona del
 * proceso, que en este despliegue es America/Santiago (docker-compose.yml).
 */
function toInstant(value: string | undefined) {
  if (!value || /[zZ]|[+-]\d{2}:\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
}

export async function createFuelCycleMovementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:create") } catch { return { ok: false, message: "No tienes permisos para registrar movimientos" } }
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
    revalidatePath("/combustibles/ciclo"); revalidatePath("/combustibles")
    return { ok: true, message: "Movimiento físico registrado" }
  } catch (error) {
    logger.error("[createFuelCycleMovementAction]", error)
    const message = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo registrar el movimiento"
    return { ok: false, message }
  }
}

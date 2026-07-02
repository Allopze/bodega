"use server"

import { revalidatePath } from "next/cache"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fuelVehicles } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  createFuelVehicleSchema,
  updateFuelVehicleSchema,
} from "@/lib/combustibles/validation"
import type { ActionState } from "@/lib/validation/masters"
import { dbErrMsg } from "./loads"

function canManageFuelVehicleWorksite(session: Session, worksiteId: string | null | undefined): boolean {
  if (!worksiteId) return false
  return canAccessWorksite(session, worksiteId)
}

export async function createFuelVehicleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = createFuelVehicleSchema.safeParse({
    plate: formData.get("plate"),
    type: formData.get("type"),
    brand: formData.get("brand") || undefined,
    model: formData.get("model") || undefined,
    year: formData.get("year") || undefined,
    worksiteId: formData.get("worksiteId") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  if (!canManageFuelVehicleWorksite(session, parsed.data.worksiteId)) {
    return { ok: false, message: "No puedes gestionar vehículos para esta faena" }
  }

  try {
    const id = nanoid()
    await db.insert(fuelVehicles).values({ id, ...parsed.data })
    revalidatePath("/combustibles/vehiculos")
    return { ok: true, message: "Vehículo creado", data: { id } }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al crear vehículo") }
  }
}

export async function updateFuelVehicleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "ID requerido" }

  const parsed = updateFuelVehicleSchema.safeParse({
    id,
    plate: formData.get("plate") || undefined,
    type: formData.get("type") || undefined,
    brand: formData.get("brand") || undefined,
    model: formData.get("model") || undefined,
    year: formData.get("year") || undefined,
    worksiteId: formData.get("worksiteId") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const existing = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, id) })
  if (!existing) return { ok: false, message: "Vehículo no encontrado" }
  if (!canManageFuelVehicleWorksite(session, existing.worksiteId)) {
    return { ok: false, message: "No puedes gestionar vehículos para esta faena" }
  }
  if (parsed.data.worksiteId && !canManageFuelVehicleWorksite(session, parsed.data.worksiteId)) {
    return { ok: false, message: "No puedes gestionar vehículos para esta faena" }
  }

  try {
    const { id: _, ...data } = parsed.data
    await db.update(fuelVehicles).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, id))
    revalidatePath("/combustibles/vehiculos")
    return { ok: true, message: "Vehículo actualizado" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al actualizar") }
  }
}

export async function deleteFuelVehicleAction(id: string): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const existing = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, id) })
  if (!existing) return { ok: false, message: "Vehículo no encontrado" }
  if (!canManageFuelVehicleWorksite(session, existing.worksiteId)) {
    return { ok: false, message: "No puedes gestionar vehículos para esta faena" }
  }

  try {
    await db.update(fuelVehicles).set({ isActive: false, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, id))
    revalidatePath("/combustibles/vehiculos")
    return { ok: true, message: "Vehículo desactivado" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al desactivar") }
  }
}

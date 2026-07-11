"use server"

import { revalidatePath } from "next/cache"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fuelVehicles } from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  createFuelVehicleSchema,
  updateFuelVehicleSchema,
} from "@/lib/combustibles/validation"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import type { ActionState } from "@/lib/validation/masters"
import { dbErrMsg } from "./loads"

function canManageFuelVehicleWorksite(session: Session, worksiteId: string): boolean {
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
    code: formData.get("code") || undefined,
    brand: formData.get("brand") || undefined,
    model: formData.get("model") || undefined,
    year: formData.get("year") || undefined,
    worksiteId: formData.get("worksiteId") || undefined,
    responsibleUserId: formData.get("responsibleUserId") || undefined,
    operationalStatus: formData.get("operationalStatus") || undefined,
    soapExpiresAt: formData.get("soapExpiresAt") || undefined,
    technicalReviewExpiresAt: formData.get("technicalReviewExpiresAt") || undefined,
    circulationPermitExpiresAt: formData.get("circulationPermitExpiresAt") || undefined,
    insurancePolicyNumber: formData.get("insurancePolicyNumber") || undefined,
    insuranceExpiresAt: formData.get("insuranceExpiresAt") || undefined,
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
    const operationalStatus = parsed.data.operationalStatus ?? (await getFleetAdminSettings()).defaultVehicleStatus
    await db.insert(fuelVehicles).values({ id, ...parsed.data, operationalStatus })
    revalidatePath("/admin/flota-catalogos/vehiculos")
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
    code: formData.get("code") || undefined,
    brand: formData.get("brand") || undefined,
    model: formData.get("model") || undefined,
    year: formData.get("year") || undefined,
    worksiteId: formData.get("worksiteId") || undefined,
    responsibleUserId: formData.get("responsibleUserId") || undefined,
    operationalStatus: formData.get("operationalStatus") || undefined,
    soapExpiresAt: formData.get("soapExpiresAt") || undefined,
    technicalReviewExpiresAt: formData.get("technicalReviewExpiresAt") || undefined,
    circulationPermitExpiresAt: formData.get("circulationPermitExpiresAt") || undefined,
    insurancePolicyNumber: formData.get("insurancePolicyNumber") || undefined,
    insuranceExpiresAt: formData.get("insuranceExpiresAt") || undefined,
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
    revalidatePath("/admin/flota-catalogos/vehiculos")
    return { ok: true, message: "Vehículo actualizado" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al actualizar") }
  }
}

export async function toggleFuelVehicleActiveAction(id: string, activate: boolean): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const existing = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, id) })
  if (!existing) return { ok: false, message: "Vehículo no encontrado" }
  if (!canManageFuelVehicleWorksite(session, existing.worksiteId)) {
    return { ok: false, message: "No puedes gestionar vehículos para esta faena" }
  }

  try {
    await db.update(fuelVehicles).set({ isActive: activate, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, id))
    revalidatePath("/admin/flota-catalogos/vehiculos")
    return { ok: true, message: activate ? "Vehículo activado" : "Vehículo desactivado" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, activate ? "Error al activar" : "Error al desactivar") }
  }
}

export async function bulkToggleFuelVehicleActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try { await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const idsRaw = formData.get("ids") as string
  const activate = formData.get("activate") === "true"
  if (!idsRaw) return { ok: false, message: "IDs requeridos" }

  const ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) return { ok: false, message: "Selecciona al menos un vehículo" }
  if (ids.length > 100) return { ok: false, message: "Máximo 100 vehículos por operación" }

  try {
    const now = new Date().toISOString()
    await db.update(fuelVehicles)
      .set({ isActive: activate, updatedAt: now })
      .where(inArray(fuelVehicles.id, ids))

    revalidatePath("/admin/flota-catalogos/vehiculos")
    return { ok: true, message: `${ids.length} vehículo${ids.length === 1 ? "" : "s"} ${activate ? "activado" : "desactivado"}${ids.length === 1 ? "" : "s"}` }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, activate ? "Error al activar" : "Error al desactivar") }
  }
}

"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentTypes } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { fuelEquipmentTypeSchema, fuelEquipmentTypeSlug } from "@/lib/combustibles/validation"
import { nanoid } from "@/lib/id"
import type { ActionState } from "@/lib/validation/masters"

const PATH = "/admin/flota-catalogos/tipos-equipo"

function input(formData: FormData) {
  return {
    name: formData.get("name"),
    category: formData.get("category"),
    defaultMeterType: formData.get("defaultMeterType"),
    defaultPerformanceUnit: formData.get("defaultPerformanceUnit"),
    description: formData.get("description") || undefined,
    sortOrder: formData.get("sortOrder") || 0,
  }
}
export async function createFuelEquipmentTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:fleet_catalog") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = fuelEquipmentTypeSchema.safeParse(input(formData))
  if (!parsed.success) return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }

  const id = `fet-${nanoid()}`
  const values = { ...parsed.data, id, slug: fuelEquipmentTypeSlug(parsed.data.name) }
  try {
    await db.transaction(async (tx) => {
      await tx.insert(fuelEquipmentTypes).values(values)
      await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "fuel_equipment_type", entityId: id, newState: values }, tx)
    })
    revalidatePath(PATH)
    revalidatePath("/admin/flota-catalogos/vehiculos")
    return { ok: true, message: "Tipo de equipo creado", data: { id } }
  } catch (error) {
    return { ok: false, message: error instanceof Error && /unique|duplicate/i.test(error.message) ? "Ya existe un tipo con ese nombre" : "No se pudo crear el tipo de equipo" }
  }
}

export async function updateFuelEquipmentTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:fleet_catalog") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "ID requerido" }
  const parsed = fuelEquipmentTypeSchema.safeParse(input(formData))
  if (!parsed.success) return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  const existing = await db.query.fuelEquipmentTypes.findFirst({ where: eq(fuelEquipmentTypes.id, id) })
  if (!existing) return { ok: false, message: "Tipo de equipo no encontrado" }

  const nextState = { ...parsed.data, updatedAt: new Date().toISOString() }
  try {
    await db.transaction(async (tx) => {
      await tx.update(fuelEquipmentTypes).set(nextState).where(eq(fuelEquipmentTypes.id, id))
      await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "fuel_equipment_type", entityId: id, oldState: existing, newState: nextState }, tx)
    })
    revalidatePath(PATH)
    revalidatePath("/admin/flota-catalogos/vehiculos")
    return { ok: true, message: "Tipo de equipo actualizado" }
  } catch {
    return { ok: false, message: "No se pudo actualizar el tipo de equipo" }
  }
}

export async function setFuelEquipmentTypeStatusAction(id: string, isActive: boolean): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:fleet_catalog") }
  catch { return { ok: false, message: "Sin permisos" } }
  const existing = await db.query.fuelEquipmentTypes.findFirst({ where: eq(fuelEquipmentTypes.id, id) })
  if (!existing) return { ok: false, message: "Tipo de equipo no encontrado" }
  const nextState = { isActive, updatedAt: new Date().toISOString() }
  try {
    await db.transaction(async (tx) => {
      await tx.update(fuelEquipmentTypes).set(nextState).where(eq(fuelEquipmentTypes.id, id))
      await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "fuel_equipment_type", entityId: id, oldState: { isActive: existing.isActive }, newState: { isActive } }, tx)
    })
    revalidatePath(PATH)
    revalidatePath("/admin/flota-catalogos/vehiculos")
    return { ok: true, message: isActive ? "Tipo activado" : "Tipo desactivado" }
  } catch {
    return { ok: false, message: "No se pudo cambiar el estado" }
  }
}

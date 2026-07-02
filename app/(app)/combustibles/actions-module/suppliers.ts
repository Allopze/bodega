"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { fuelSuppliers } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { nanoid } from "@/lib/id"
import {
  createFuelSupplierSchema,
  updateFuelSupplierSchema,
} from "@/lib/combustibles/validation"
import type { ActionState } from "@/lib/validation/masters"
import { dbErrMsg } from "./loads"

export async function createFuelSupplierAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try { await requirePermission("combustibles:manage_suppliers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = createFuelSupplierSchema.safeParse({
    name: formData.get("name"),
    rut: formData.get("rut") || undefined,
    contactName: formData.get("contactName") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const id = nanoid()
    await db.insert(fuelSuppliers).values({ id, ...parsed.data })
    revalidatePath("/combustibles/proveedores-combustible")
    return { ok: true, message: "Proveedor creado", data: { id } }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al crear proveedor") }
  }
}

export async function updateFuelSupplierAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try { await requirePermission("combustibles:manage_suppliers") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "ID requerido" }

  const parsed = updateFuelSupplierSchema.safeParse({
    id,
    name: formData.get("name") || undefined,
    rut: formData.get("rut") || undefined,
    contactName: formData.get("contactName") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const { id: _, ...data } = parsed.data
    await db.update(fuelSuppliers).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(fuelSuppliers.id, id))
    revalidatePath("/combustibles/proveedores-combustible")
    return { ok: true, message: "Proveedor actualizado" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al actualizar") }
  }
}

export async function deleteFuelSupplierAction(id: string): Promise<ActionState> {
  try { await requirePermission("combustibles:manage_suppliers") }
  catch { return { ok: false, message: "Sin permisos" } }

  try {
    await db.update(fuelSuppliers).set({ isActive: false, updatedAt: new Date().toISOString() }).where(eq(fuelSuppliers.id, id))
    revalidatePath("/combustibles/proveedores-combustible")
    return { ok: true, message: "Proveedor desactivado" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al desactivar") }
  }
}

"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelProducts } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { fuelProductSchema } from "@/lib/combustibles/validation"
import { nanoid } from "@/lib/id"
import type { ActionState } from "@/lib/validation/masters"

const PATH = "/admin/flota-catalogos/productos-combustible"

function input(formData: FormData) {
  return {
    code: String(formData.get("code") ?? "").trim().toUpperCase(),
    name: formData.get("name"),
    category: formData.get("category"),
    unit: formData.get("unit"),
    aliases: String(formData.get("aliases") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    description: formData.get("description") || undefined,
  }
}

export async function createFuelProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:fleet_catalog") } catch { return { ok: false, message: "Sin permisos" } }
  const parsed = fuelProductSchema.safeParse(input(formData))
  if (!parsed.success) return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  const id = `fuel-product-${nanoid()}`
  try {
    await db.transaction(async (tx) => {
      await tx.insert(fuelProducts).values({ id, ...parsed.data })
      await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "fuel_product", entityId: id, newState: parsed.data }, tx)
    })
    revalidatePath(PATH); revalidatePath("/admin/flota-catalogos/vehiculos")
    return { ok: true, message: "Producto creado", data: { id } }
  } catch (error) {
    return { ok: false, message: error instanceof Error && /unique|duplicate/i.test(error.message) ? "Ya existe un producto con ese código" : "No se pudo crear el producto" }
  }
}

export async function updateFuelProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:fleet_catalog") } catch { return { ok: false, message: "Sin permisos" } }
  const id = String(formData.get("id") ?? "")
  const parsed = fuelProductSchema.safeParse(input(formData))
  if (!id) return { ok: false, message: "ID requerido" }
  if (!parsed.success) return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  const existing = await db.query.fuelProducts.findFirst({ where: eq(fuelProducts.id, id) })
  if (!existing) return { ok: false, message: "Producto no encontrado" }
  const nextState = { ...parsed.data, updatedAt: new Date().toISOString() }
  try {
    await db.transaction(async (tx) => {
      await tx.update(fuelProducts).set(nextState).where(eq(fuelProducts.id, id))
      await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "fuel_product", entityId: id, oldState: existing, newState: nextState }, tx)
    })
    revalidatePath(PATH); revalidatePath("/admin/flota-catalogos/vehiculos")
    return { ok: true, message: "Producto actualizado" }
  } catch { return { ok: false, message: "No se pudo actualizar el producto" } }
}

export async function setFuelProductStatusAction(id: string, isActive: boolean): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:fleet_catalog") } catch { return { ok: false, message: "Sin permisos" } }
  const existing = await db.query.fuelProducts.findFirst({ where: eq(fuelProducts.id, id) })
  if (!existing) return { ok: false, message: "Producto no encontrado" }
  const nextState = { isActive, updatedAt: new Date().toISOString() }
  try {
    await db.transaction(async (tx) => {
      await tx.update(fuelProducts).set(nextState).where(eq(fuelProducts.id, id))
      await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "fuel_product", entityId: id, oldState: { isActive: existing.isActive }, newState: { isActive } }, tx)
    })
    revalidatePath(PATH); revalidatePath("/admin/flota-catalogos/vehiculos")
    return { ok: true, message: isActive ? "Producto activado" : "Producto desactivado" }
  } catch { return { ok: false, message: "No se pudo cambiar el estado" } }
}

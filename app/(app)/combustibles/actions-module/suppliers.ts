"use server"

import { revalidatePath } from "next/cache"
import { eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelSuppliers, suppliers } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { cleanRut } from "@/lib/rut"
import {
  createFuelSupplierSchema,
  updateFuelSupplierSchema,
} from "@/lib/combustibles/validation"
import type { ActionState } from "@/lib/validation/masters"
import { dbErrMsg } from "./loads"

const REVALIDATE = "/admin/flota-catalogos/proveedores-combustible"

/** Forma compacta (sin guion) del RUT, sólo para comparar contra datos legacy
 *  que puede que no estén en la forma canónica `cleanRut` (con guion). */
function compactRut(value: string) {
  return cleanRut(value).replace("-", "")
}

type FuelSupplierIdentity = {
  supplierId?: string
  name: string
  rut?: string
  contactName?: string
  contactPhone?: string
  contactEmail?: string
  notes?: string
}

function identityValues(input: FuelSupplierIdentity) {
  return {
    name: input.name,
    // Forma canónica (mayúsculas, sin puntos, con guion — lib/rut.ts es la
    // fuente única). Antes se guardaba crudo pese a que el UNIQUE de la
    // columna es sobre el string literal: "76.123.456-7" y "761234567"
    // convivían como proveedores distintos.
    rut: input.rut ? cleanRut(input.rut) : null,
    contactName: input.contactName ?? null,
    phone: input.contactPhone ?? null,
    email: input.contactEmail ?? null,
    notes: input.notes ?? null,
  }
}

async function resolveGeneralSupplier(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: FuelSupplierIdentity,
  existingSupplierId?: string | null,
) {
  let supplierId = input.supplierId || existingSupplierId || null

  if (input.rut) {
    const byRut = await tx.query.suppliers.findFirst({
      where: sql`regexp_replace(upper(${suppliers.rut}), '[.\\-[:space:]]', '', 'g') = ${compactRut(input.rut)}`,
    })
    if (byRut && byRut.id !== supplierId) {
      if (supplierId) throw new Error("El RUT ya pertenece a otro proveedor general")
      supplierId = byRut.id
    }
  }

  if (supplierId) {
    const existing = await tx.query.suppliers.findFirst({ where: eq(suppliers.id, supplierId) })
    if (!existing) throw new Error("Proveedor general no encontrado")
    await tx.update(suppliers).set({ ...identityValues(input), updatedAt: new Date().toISOString() }).where(eq(suppliers.id, supplierId))
    return supplierId
  }

  const id = nanoid()
  await tx.insert(suppliers).values({
    id,
    ...identityValues(input),
    isActive: true,
  })
  return id
}

function parseCreateInput(formData: FormData) {
  return createFuelSupplierSchema.safeParse({
    supplierId: formData.get("supplierId") || undefined,
    name: formData.get("name"),
    rut: formData.get("rut") || undefined,
    contactName: formData.get("contactName") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    notes: formData.get("notes") || undefined,
  })
}

function parseUpdateInput(formData: FormData, id: string) {
  return updateFuelSupplierSchema.safeParse({
    id,
    supplierId: formData.get("supplierId") || undefined,
    name: formData.get("name") || undefined,
    rut: formData.get("rut") || undefined,
    contactName: formData.get("contactName") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    notes: formData.get("notes") || undefined,
  })
}

export async function createFuelSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_suppliers", "/combustibles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = parseCreateInput(formData)
  if (!parsed.success) return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }

  try {
    const result = await db.transaction(async (tx) => {
      const supplierId = await resolveGeneralSupplier(tx, parsed.data)
      const id = nanoid()
      const rut = parsed.data.rut ? cleanRut(parsed.data.rut) : null
      await tx.insert(fuelSuppliers).values({
        id,
        supplierId,
        name: parsed.data.name,
        rut,
        contactName: parsed.data.contactName ?? null,
        contactPhone: parsed.data.contactPhone ?? null,
        contactEmail: parsed.data.contactEmail ?? null,
        notes: parsed.data.notes ?? null,
        isActive: true,
      })
      return { id, supplierId, rut }
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "create",
      entityType: "fuel_supplier",
      entityId: result.id,
      newState: { supplierId: result.supplierId, name: parsed.data.name, rut: result.rut, isActive: true },
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Proveedor creado", data: result }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al crear proveedor") }
  }
}

export async function updateFuelSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_suppliers", "/combustibles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "ID requerido" }
  const parsed = parseUpdateInput(formData, id)
  if (!parsed.success) return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }

  try {
    const current = await db.query.fuelSuppliers.findFirst({ where: eq(fuelSuppliers.id, id) })
    if (!current) return { ok: false, message: "Proveedor no encontrado" }

    const identity: FuelSupplierIdentity = {
      supplierId: parsed.data.supplierId,
      name: parsed.data.name ?? current.name,
      rut: parsed.data.rut ?? current.rut ?? undefined,
      contactName: parsed.data.contactName ?? current.contactName ?? undefined,
      contactPhone: parsed.data.contactPhone ?? current.contactPhone ?? undefined,
      contactEmail: parsed.data.contactEmail ?? current.contactEmail ?? undefined,
      notes: parsed.data.notes ?? current.notes ?? undefined,
    }
    const rut = identity.rut ? cleanRut(identity.rut) : null

    const result = await db.transaction(async (tx) => {
      const supplierId = await resolveGeneralSupplier(tx, identity, current.supplierId)
      await tx.update(fuelSuppliers).set({
        supplierId,
        name: identity.name,
        rut,
        contactName: identity.contactName ?? null,
        contactPhone: identity.contactPhone ?? null,
        contactEmail: identity.contactEmail ?? null,
        notes: identity.notes ?? null,
        updatedAt: new Date().toISOString(),
      }).where(eq(fuelSuppliers.id, id))
      return { supplierId }
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "fuel_supplier",
      entityId: id,
      oldState: { supplierId: current.supplierId, name: current.name, rut: current.rut, isActive: current.isActive },
      newState: { supplierId: result.supplierId, name: identity.name, rut, isActive: current.isActive },
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Proveedor actualizado" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al actualizar") }
  }
}

export async function toggleFuelSupplierActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_suppliers", "/combustibles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  const activate = formData.get("activate") === "true"
  if (!id) return { ok: false, message: "ID requerido" }

  try {
    const current = await db.query.fuelSuppliers.findFirst({ where: eq(fuelSuppliers.id, id) })
    if (!current) return { ok: false, message: "Proveedor no encontrado" }
    await db.update(fuelSuppliers).set({ isActive: activate, updatedAt: new Date().toISOString() }).where(eq(fuelSuppliers.id, id))
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "fuel_supplier",
      entityId: id,
      oldState: { isActive: current.isActive },
      newState: { isActive: activate },
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: activate ? "Proveedor activado" : "Proveedor desactivado" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, activate ? "Error al activar" : "Error al desactivar") }
  }
}

/** Compatibility wrapper for old callers; new UI uses the form action above. */
export async function deleteFuelSupplierAction(id: string): Promise<ActionState> {
  const formData = new FormData()
  formData.set("id", id)
  formData.set("activate", "false")
  return toggleFuelSupplierActive({ ok: false }, formData)
}

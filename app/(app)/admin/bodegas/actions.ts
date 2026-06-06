"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { warehouses } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { warehouseSchema, type ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/bodegas"

export async function createWarehouse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:config") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = warehouseSchema.safeParse({
    name:        formData.get("name"),
    code:        formData.get("code"),
    type:        formData.get("type"),
    worksiteId:  formData.get("worksiteId") || null,
    address:     formData.get("address") || undefined,
    notes:       formData.get("notes") || undefined,
    isActive:    formData.get("isActive") === "on",
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data

  const exists = await db.query.warehouses.findFirst({ where: eq(warehouses.code, d.code) })
  if (exists) return { ok: false, fieldErrors: { code: ["Este código ya existe"] } }

  const id = nanoid()
  await db.insert(warehouses).values({
    id, name: d.name, code: d.code, type: d.type,
    worksiteId: d.worksiteId || null,
    address:    d.address   ?? null,
    notes:      d.notes     ?? null,
    isActive:   d.isActive,
  })

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "warehouse", entityId: id, entityCode: d.code, newState: { name: d.name, code: d.code, type: d.type } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Bodega ${d.name} creada` }
}

export async function updateWarehouse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:config") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = warehouseSchema.safeParse({
    id:          formData.get("id"),
    name:        formData.get("name"),
    code:        formData.get("code"),
    type:        formData.get("type"),
    worksiteId:  formData.get("worksiteId") || null,
    address:     formData.get("address") || undefined,
    notes:       formData.get("notes") || undefined,
    isActive:    formData.get("isActive") === "on",
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data
  if (!d.id) return { ok: false, message: "ID requerido" }

  const conflict = await db.query.warehouses.findFirst({ where: eq(warehouses.code, d.code) })
  if (conflict && conflict.id !== d.id) return { ok: false, fieldErrors: { code: ["Este código ya existe"] } }

  const current = await db.query.warehouses.findFirst({ where: eq(warehouses.id, d.id) })
  if (!current) return { ok: false, message: "Bodega no encontrada" }

  await db.update(warehouses).set({
    name: d.name, code: d.code, type: d.type,
    worksiteId: d.worksiteId || null,
    address: d.address ?? null,
    notes:   d.notes   ?? null,
    isActive: d.isActive,
  }).where(eq(warehouses.id, d.id))

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "warehouse", entityId: d.id, entityCode: d.code, oldState: { name: current.name, isActive: current.isActive }, newState: { name: d.name, isActive: d.isActive } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Bodega ${d.name} actualizada` }
}

export async function toggleWarehouseActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:config") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id       = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  if (!id) return { ok: false, message: "ID requerido" }

  await db.update(warehouses).set({ isActive: activate }).where(eq(warehouses.id, id))

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "warehouse", entityId: id, oldState: { isActive: !activate }, newState: { isActive: activate } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: activate ? "Bodega activada" : "Bodega desactivada" }
}

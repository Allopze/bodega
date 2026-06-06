"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { worksites, costCenters } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { worksiteSchema, costCenterSchema, type ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/faenas"

// ── Worksites ─────────────────────────────────────────────────────────────────

export async function createWorksite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:worksites") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = worksiteSchema.safeParse({
    name:     formData.get("name"),
    code:     formData.get("code"),
    address:  formData.get("address") || undefined,
    region:   formData.get("region")  || undefined,
    isActive: formData.get("isActive") === "on",
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data

  // Code uniqueness
  const exists = await db.query.worksites.findFirst({ where: eq(worksites.code, d.code) })
  if (exists) return { ok: false, fieldErrors: { code: ["Este código ya existe"] } }

  const id = nanoid()
  await db.insert(worksites).values({ id, name: d.name, code: d.code, address: d.address ?? null, region: d.region ?? null, isActive: d.isActive })

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "worksite", entityId: id, entityCode: d.code, newState: { name: d.name, code: d.code } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Faena ${d.name} creada` }
}

export async function updateWorksite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:worksites") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = worksiteSchema.safeParse({
    id:       formData.get("id"),
    name:     formData.get("name"),
    code:     formData.get("code"),
    address:  formData.get("address") || undefined,
    region:   formData.get("region")  || undefined,
    isActive: formData.get("isActive") === "on",
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data
  if (!d.id) return { ok: false, message: "ID requerido" }

  const conflict = await db.query.worksites.findFirst({ where: eq(worksites.code, d.code) })
  if (conflict && conflict.id !== d.id) return { ok: false, fieldErrors: { code: ["Este código ya existe"] } }

  const current = await db.query.worksites.findFirst({ where: eq(worksites.id, d.id) })
  if (!current) return { ok: false, message: "Faena no encontrada" }

  await db.update(worksites).set({ name: d.name, code: d.code, address: d.address ?? null, region: d.region ?? null, isActive: d.isActive, updatedAt: new Date().toISOString() }).where(eq(worksites.id, d.id))

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "worksite", entityId: d.id, entityCode: d.code, oldState: { name: current.name, isActive: current.isActive }, newState: { name: d.name, isActive: d.isActive } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Faena ${d.name} actualizada` }
}

export async function toggleWorksiteActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:worksites") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id       = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  if (!id) return { ok: false, message: "ID requerido" }

  await db.update(worksites).set({ isActive: activate, updatedAt: new Date().toISOString() }).where(eq(worksites.id, id))

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "worksite", entityId: id, oldState: { isActive: !activate }, newState: { isActive: activate } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: activate ? "Faena activada" : "Faena desactivada" }
}

// ── Cost Centers ──────────────────────────────────────────────────────────────

export async function createCostCenter(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:worksites") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = costCenterSchema.safeParse({
    name:       formData.get("name"),
    code:       formData.get("code"),
    worksiteId: formData.get("worksiteId"),
    isActive:   formData.get("isActive") === "on",
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data

  const exists = await db.query.costCenters.findFirst({ where: eq(costCenters.code, d.code) })
  if (exists) return { ok: false, fieldErrors: { code: ["Este código ya existe"] } }

  const id = nanoid()
  await db.insert(costCenters).values({ id, name: d.name, code: d.code, worksiteId: d.worksiteId, isActive: d.isActive })

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "cost_center", entityId: id, entityCode: d.code, newState: { name: d.name, code: d.code, worksiteId: d.worksiteId } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Centro de costo ${d.name} creado` }
}

export async function updateCostCenter(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:worksites") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = costCenterSchema.safeParse({
    id:         formData.get("id"),
    name:       formData.get("name"),
    code:       formData.get("code"),
    worksiteId: formData.get("worksiteId"),
    isActive:   formData.get("isActive") === "on",
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data
  if (!d.id) return { ok: false, message: "ID requerido" }

  const conflict = await db.query.costCenters.findFirst({ where: eq(costCenters.code, d.code) })
  if (conflict && conflict.id !== d.id) return { ok: false, fieldErrors: { code: ["Este código ya existe"] } }

  const current = await db.query.costCenters.findFirst({ where: eq(costCenters.id, d.id) })
  if (!current) return { ok: false, message: "Centro de costo no encontrado" }

  await db.update(costCenters).set({ name: d.name, code: d.code, worksiteId: d.worksiteId, isActive: d.isActive }).where(eq(costCenters.id, d.id))

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "cost_center", entityId: d.id, entityCode: d.code, oldState: { name: current.name }, newState: { name: d.name } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Centro ${d.name} actualizado` }
}

export async function toggleCostCenterActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:worksites") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id       = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  if (!id) return { ok: false, message: "ID requerido" }

  await db.update(costCenters).set({ isActive: activate }).where(eq(costCenters.id, id))

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "cost_center", entityId: id, oldState: { isActive: !activate }, newState: { isActive: activate } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: activate ? "Centro activado" : "Centro desactivado" }
}

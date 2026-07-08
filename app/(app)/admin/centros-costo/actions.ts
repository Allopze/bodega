"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { costCenters } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { costCenterFormSchema } from "@/lib/validation/cost-centers"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/centros-costo"

function errorState(message: string): ActionState {
  return { ok: false, message }
}

export async function createCostCenterAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:cost_centers")
  } catch {
    return errorState("Sin permisos")
  }

  const parsed = costCenterFormSchema.safeParse({
    id:          formData.get("id") || undefined,
    code:        formData.get("code"),
    name:        formData.get("name"),
    worksiteId:  formData.get("worksiteId") || undefined,
    description: formData.get("description") || undefined,
    isActive:    formData.get("isActive") === "on",
  })
  if (!parsed.success) {
    return {
      ok:         false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  const d = parsed.data

  const exists = await db.query.costCenters.findFirst({ where: eq(costCenters.code, d.code) })
  if (exists) {
    return { ok: false, fieldErrors: { code: ["Este código ya existe"] } }
  }

  const id = nanoid()
  await db.insert(costCenters).values({
    id,
    code:        d.code,
    name:        d.name,
    worksiteId:  d.worksiteId ?? null,
    description: d.description ?? null,
    isActive:    d.isActive,
  })

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "create",
    entityType: "cost_center",
    entityId:   id,
    entityCode: d.code,
    newState:   { code: d.code, name: d.name, worksiteId: d.worksiteId ?? null, isActive: d.isActive },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Centro de costo ${d.name} creado` }
}

export async function updateCostCenterAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:cost_centers")
  } catch {
    return errorState("Sin permisos")
  }

  const parsed = costCenterFormSchema.safeParse({
    id:          formData.get("id") || undefined,
    code:        formData.get("code"),
    name:        formData.get("name"),
    worksiteId:  formData.get("worksiteId") || undefined,
    description: formData.get("description") || undefined,
    isActive:    formData.get("isActive") === "on",
  })
  if (!parsed.success) {
    return {
      ok:         false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  const d = parsed.data
  if (!d.id) return errorState("ID requerido")

  const conflict = await db.query.costCenters.findFirst({ where: eq(costCenters.code, d.code) })
  if (conflict && conflict.id !== d.id) {
    return { ok: false, fieldErrors: { code: ["Este código ya existe"] } }
  }

  const current = await db.query.costCenters.findFirst({ where: eq(costCenters.id, d.id) })
  if (!current) return errorState("Centro de costo no encontrado")

  await db
    .update(costCenters)
    .set({
      code:        d.code,
      name:        d.name,
      worksiteId:  d.worksiteId ?? null,
      description: d.description ?? null,
      isActive:    d.isActive,
      updatedAt:   new Date().toISOString(),
    })
    .where(eq(costCenters.id, d.id))

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "update",
    entityType: "cost_center",
    entityId:   d.id,
    entityCode: d.code,
    oldState:   { name: current.name, isActive: current.isActive, worksiteId: current.worksiteId },
    newState:   { name: d.name, isActive: d.isActive, worksiteId: d.worksiteId ?? null },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Centro de costo ${d.name} actualizado` }
}

export async function setCostCenterActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:cost_centers")
  } catch {
    return errorState("Sin permisos")
  }

  const id = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  if (!id) return errorState("ID requerido")

  const current = await db.query.costCenters.findFirst({ where: eq(costCenters.id, id) })
  if (!current) return errorState("Centro de costo no encontrado")

  await db
    .update(costCenters)
    .set({ isActive: activate, updatedAt: new Date().toISOString() })
    .where(eq(costCenters.id, id))

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "update",
    entityType: "cost_center",
    entityId:   id,
    entityCode: current.code,
    oldState:   { isActive: current.isActive },
    newState:   { isActive: activate },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: activate ? "Centro de costo activado" : "Centro de costo desactivado" }
}

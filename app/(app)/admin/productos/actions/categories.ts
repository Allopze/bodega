"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { productCategories } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { productCategorySchema, type ActionState } from "@/lib/validation/masters"
import { formString, REVALIDATE } from "./helpers"

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = productCategorySchema.safeParse({
    name:               formData.get("name"),
    slug:               formData.get("slug"),
    isEpp:              formData.get("isEpp") === "on",
    requiresPrevencion: formData.get("requiresPrevencion") === "on",
    sortOrder:          formData.get("sortOrder") || 0,
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data

  const exists = await db.query.productCategories.findFirst({ where: eq(productCategories.slug, d.slug) })
  if (exists) return { ok: false, fieldErrors: { slug: ["Este slug ya existe"] } }

  const id = nanoid()
  await db.insert(productCategories).values({ id, name: d.name, slug: d.slug, isEpp: d.isEpp, requiresPrevencion: d.requiresPrevencion, sortOrder: d.sortOrder })

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "product_category", entityId: id, newState: { name: d.name, slug: d.slug } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Categoría ${d.name} creada` }
}

export async function updateCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = productCategorySchema.safeParse({
    id:                 formString(formData, "id"),
    name:               formData.get("name"),
    slug:               formData.get("slug"),
    isEpp:              formData.get("isEpp") === "on",
    requiresPrevencion: formData.get("requiresPrevencion") === "on",
    sortOrder:          formData.get("sortOrder") || 0,
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data
  if (!d.id) return { ok: false, message: "ID requerido" }

  const conflict = await db.query.productCategories.findFirst({ where: eq(productCategories.slug, d.slug) })
  if (conflict && conflict.id !== d.id) return { ok: false, fieldErrors: { slug: ["Este slug ya existe"] } }

  await db.update(productCategories).set({ name: d.name, slug: d.slug, isEpp: d.isEpp, requiresPrevencion: d.requiresPrevencion, sortOrder: d.sortOrder }).where(eq(productCategories.id, d.id))

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "product_category", entityId: d.id, newState: { name: d.name } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Categoría ${d.name} actualizada` }
}

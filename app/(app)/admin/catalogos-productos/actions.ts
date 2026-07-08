"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { productAttributeTemplates, productUnits } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import {
  productAttributeTemplateSchema,
  productUnitSchema,
  type ProductAttributeTemplateInput,
  type ProductUnitInput,
} from "@/lib/validation/product-catalogs"
import type { ActionState } from "@/lib/validation/masters"
import { nanoid } from "@/lib/id"

const REVALIDATE = "/admin/catalogos-productos"

function errorState(message: string): ActionState {
  return { ok: false, message }
}

function jsonOptionsString(text: string | undefined): string | null {
  if (!text) return null
  const items = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)
  return JSON.stringify(items)
}

export async function saveProductUnitAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:product_catalogs")
  } catch {
    return errorState("Sin permisos")
  }

  const parsed = productUnitSchema.safeParse({
    id:          formData.get("id") || undefined,
    code:        formData.get("code"),
    label:       formData.get("label"),
    description: formData.get("description") || undefined,
    sortOrder:   formData.get("sortOrder") ?? 0,
    isActive:    formData.get("isActive") === "on",
  })
  if (!parsed.success) {
    return {
      ok:         false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  const d: ProductUnitInput = parsed.data

  const exists = await db.query.productUnits.findFirst({ where: eq(productUnits.code, d.code) })
  if (exists && exists.id !== d.id) {
    return { ok: false, fieldErrors: { code: ["Este código ya existe"] } }
  }

  const id = d.id ?? `unit-${nanoid()}`
  const now = new Date().toISOString()
  await db
    .insert(productUnits)
    .values({
      id,
      code:        d.code,
      label:       d.label,
      description: d.description ?? null,
      sortOrder:   d.sortOrder,
      isActive:    d.isActive,
      updatedAt:   now,
    })
    .onConflictDoUpdate({
      target: productUnits.id,
      set: {
        code:        d.code,
        label:       d.label,
        description: d.description ?? null,
        sortOrder:   d.sortOrder,
        isActive:    d.isActive,
        updatedAt:   now,
      },
    })

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "update",
    entityType: "product_unit",
    entityId:   id,
    entityCode: d.code,
    newState:   { label: d.label, isActive: d.isActive },
  })

  revalidatePath(REVALIDATE)
  revalidatePath("/admin/productos")
  return { ok: true, message: `Unidad ${d.label} guardada` }
}

export async function setProductUnitStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:product_catalogs")
  } catch {
    return errorState("Sin permisos")
  }

  const id = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  if (!id) return errorState("ID requerido")

  const current = await db.query.productUnits.findFirst({ where: eq(productUnits.id, id) })
  if (!current) return errorState("Unidad no encontrada")

  await db
    .update(productUnits)
    .set({ isActive: activate, updatedAt: new Date().toISOString() })
    .where(eq(productUnits.id, id))

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "update",
    entityType: "product_unit",
    entityId:   id,
    entityCode: current.code,
    oldState:   { isActive: current.isActive },
    newState:   { isActive: activate },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: activate ? `Unidad ${current.label} activada` : `Unidad ${current.label} desactivada` }
}

export async function saveAttributeTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:product_catalogs")
  } catch {
    return errorState("Sin permisos")
  }

  const parsed = productAttributeTemplateSchema.safeParse({
    id:            formData.get("id") || undefined,
    categoryId:    formData.get("categoryId") || undefined,
    name:          formData.get("name"),
    type:          formData.get("type"),
    optionsText:   formData.get("optionsText") || undefined,
    isRequired:    formData.get("isRequired") === "on",
    sortOrder:     formData.get("sortOrder") ?? 0,
    isActive:      formData.get("isActive") === "on",
  })
  if (!parsed.success) {
    return {
      ok:         false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  const d: ProductAttributeTemplateInput = parsed.data

  const optionsJson = d.type === "select" ? jsonOptionsString(d.optionsText) : null

  const id = d.id ?? `attr-${nanoid()}`
  const now = new Date().toISOString()
  await db
    .insert(productAttributeTemplates)
    .values({
      id,
      categoryId:  d.categoryId ?? null,
      name:        d.name,
      type:        d.type,
      options:     optionsJson,
      isRequired:  d.isRequired,
      sortOrder:   d.sortOrder,
      isActive:    d.isActive,
      updatedAt:   now,
    })
    .onConflictDoUpdate({
      target: productAttributeTemplates.id,
      set: {
        categoryId: d.categoryId ?? null,
        name:       d.name,
        type:       d.type,
        options:    optionsJson,
        isRequired: d.isRequired,
        sortOrder:  d.sortOrder,
        isActive:   d.isActive,
        updatedAt:  now,
      },
    })

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "update",
    entityType: "product_attribute_template",
    entityId:   id,
    newState:   { name: d.name, type: d.type, categoryId: d.categoryId ?? null },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Atributo ${d.name} guardado` }
}

export async function setAttributeTemplateStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:product_catalogs")
  } catch {
    return errorState("Sin permisos")
  }

  const id = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  if (!id) return errorState("ID requerido")

  const current = await db.query.productAttributeTemplates.findFirst({ where: eq(productAttributeTemplates.id, id) })
  if (!current) return errorState("Atributo no encontrado")

  await db
    .update(productAttributeTemplates)
    .set({ isActive: activate, updatedAt: new Date().toISOString() })
    .where(eq(productAttributeTemplates.id, id))

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "update",
    entityType: "product_attribute_template",
    entityId:   id,
    oldState:   { isActive: current.isActive },
    newState:   { isActive: activate },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: activate ? `Atributo ${current.name} activado` : `Atributo ${current.name} desactivado` }
}

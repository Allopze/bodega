"use server"

import { revalidatePath } from "next/cache"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import {
  seedDefaultCategories,
  setDocumentCategoryActive,
  setDocumentTypeActive,
  upsertDocumentCategory,
  upsertDocumentType,
} from "@/lib/services/prevention-documents/taxonomy"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/taxonomia-sst"

function errorState(message: string): ActionState {
  return { ok: false, message }
}

function readFormNumber(form: FormData, key: string): number {
  const raw = form.get(key)
  if (typeof raw !== "string" || !raw.trim()) return 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function readFormBool(form: FormData, key: string, fallback: boolean): boolean {
  const raw = form.get(key)
  if (raw === null) return fallback
  return raw === "on" || raw === "true" || raw === "1"
}

export async function saveDocumentCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:document_taxonomy")
  } catch {
    return errorState("Sin permisos")
  }

  const slug = (formData.get("slug") as string | null)?.trim() ?? ""
  const name = (formData.get("name") as string | null)?.trim() ?? ""
  const description = (formData.get("description") as string | null)?.trim() || undefined

  if (!slug) return { ok: false, fieldErrors: { slug: ["Ingresa el slug"] } }
  if (!name) return { ok: false, fieldErrors: { name: ["Ingresa el nombre"] } }

  try {
    const row = await upsertDocumentCategory({
      slug,
      name,
      description,
      sortOrder: readFormNumber(formData, "sortOrder"),
      isActive: readFormBool(formData, "isActive", true),
    })
    if (!row) return errorState("La categoría no se pudo guardar")

    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "update",
      entityType: "sst_document_category",
      entityId:   row.slug,
      newState:   { name: row.name, isActive: row.isActive, sortOrder: row.sortOrder },
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: `Categoría ${row.name} guardada` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export async function saveDocumentTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:document_taxonomy")
  } catch {
    return errorState("Sin permisos")
  }

  const categorySlug = (formData.get("categorySlug") as string | null)?.trim() ?? ""
  const code = (formData.get("code") as string | null)?.trim() ?? ""
  const name = (formData.get("name") as string | null)?.trim() ?? ""
  const id = (formData.get("id") as string | null)?.trim() || undefined
  const defaultConfidentiality = (formData.get("defaultConfidentiality") as string | null || "publico_interno").trim()
  const validityRaw = (formData.get("defaultValidityMonths") as string | null)?.trim()
  const defaultValidityMonths = validityRaw ? Number(validityRaw) : undefined
  const description = (formData.get("description") as string | null)?.trim() || undefined

  if (!categorySlug) return { ok: false, fieldErrors: { categorySlug: ["Selecciona una categoría"] } }
  if (!code) return { ok: false, fieldErrors: { code: ["Ingresa el código"] } }
  if (!name) return { ok: false, fieldErrors: { name: ["Ingresa el nombre"] } }

  try {
    const row = await upsertDocumentType({
      id,
      categorySlug,
      code,
      name,
      description,
      defaultConfidentiality,
      defaultValidityMonths,
      requiresApproval: readFormBool(formData, "requiresApproval", true),
      requiresAcknowledgment: readFormBool(formData, "requiresAcknowledgment", false),
      isActive: readFormBool(formData, "isActive", true),
    })
    if (!row) return errorState("El tipo no se pudo guardar")

    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "update",
      entityType: "sst_document_type",
      entityId:   row.id,
      newState:   { categorySlug: row.categorySlug, code: row.code, name: row.name, isActive: row.isActive },
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: `Tipo ${row.name} guardado` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export async function setDocumentCategoryStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:document_taxonomy")
  } catch {
    return errorState("Sin permisos")
  }

  const slug = (formData.get("slug") as string | null)?.trim()
  const activate = formData.get("activate") === "true"
  if (!slug) return errorState("Slug requerido")

  try {
    const row = await setDocumentCategoryActive(slug, activate)
    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "update",
      entityType: "sst_document_category",
      entityId:   row.slug,
      oldState:   { isActive: !activate },
      newState:   { isActive: activate },
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: activate ? `Categoría ${row.name} activada` : `Categoría ${row.name} desactivada` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export async function setDocumentTypeStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:document_taxonomy")
  } catch {
    return errorState("Sin permisos")
  }

  const id = (formData.get("id") as string | null)?.trim()
  const activate = formData.get("activate") === "true"
  if (!id) return errorState("ID requerido")

  try {
    const row = await setDocumentTypeActive(id, activate)
    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "update",
      entityType: "sst_document_type",
      entityId:   row.id,
      oldState:   { isActive: !activate },
      newState:   { isActive: activate },
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: activate ? `Tipo ${row.name} activado` : `Tipo ${row.name} desactivado` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export async function seedDefaultDocumentCategoriesAction(_prev: ActionState): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:document_taxonomy")
  } catch {
    return errorState("Sin permisos")
  }

  try {
    await seedDefaultCategories()
    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "update",
      entityType: "sst_document_taxonomy",
      entityId:   "seed",
      newState:   { seeded: true },
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Categorías predeterminadas insertadas/actualizadas" }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

// Re-export types for client component typing
export type { ActionState }

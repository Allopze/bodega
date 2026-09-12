"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import { itAssetTypeSchema } from "@/lib/validation/ti"
import { upsertAssetType, setAssetTypeActive } from "@/lib/services/ti/asset-types"
import type { ActionState } from "@/lib/form-state"

const PERMISSION = "admin:it_asset_types"
const REVALIDATE_PATHS = ["/admin/tipos-activo", "/ti/activos"] as const

function errorState(message: string): ActionState {
  return { ok: false, message }
}

function revalidateAll() {
  for (const path of REVALIDATE_PATHS) revalidatePath(path)
}

export async function createItAssetTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission(PERMISSION)
  } catch {
    return errorState("Sin permisos")
  }

  const parsed = itAssetTypeSchema.safeParse({
    name:     formData.get("name"),
    category: formData.get("category"),
    hasSpecs: formData.get("hasSpecs") === "on",
  })
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  const d = parsed.data

  try {
    await upsertAssetType(
      { name: d.name, category: d.category, hasSpecs: d.hasSpecs },
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
    )
  } catch (e) {
    return errorState(safeActionMessage(e, "No se pudo crear el tipo de activo"))
  }

  revalidateAll()
  return { ok: true, message: `Tipo de activo «${d.name}» creado` }
}

export async function updateItAssetTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission(PERMISSION)
  } catch {
    return errorState("Sin permisos")
  }

  const parsed = itAssetTypeSchema.safeParse({
    id:       formData.get("id") || undefined,
    name:     formData.get("name"),
    category: formData.get("category"),
    hasSpecs: formData.get("hasSpecs") === "on",
  })
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  const d = parsed.data
  if (!d.id) return errorState("ID requerido")

  try {
    await upsertAssetType(
      { id: d.id, name: d.name, category: d.category, hasSpecs: d.hasSpecs },
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
    )
  } catch (e) {
    return errorState(safeActionMessage(e, "No se pudo actualizar el tipo de activo"))
  }

  revalidateAll()
  return { ok: true, message: `Tipo de activo «${d.name}» actualizado` }
}

export async function setAssetTypeActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission(PERMISSION)
  } catch {
    return errorState("Sin permisos")
  }

  const id = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  if (!id) return errorState("ID requerido")

  try {
    const row = await setAssetTypeActive(id, activate, { userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidateAll()
    return { ok: true, message: activate ? `Tipo de activo «${row.name}» activado` : `Tipo de activo «${row.name}» desactivado` }
  } catch (e) {
    return errorState(safeActionMessage(e, "No se pudo cambiar el estado del tipo de activo"))
  }
}

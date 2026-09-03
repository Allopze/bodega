"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { logger } from "@/lib/logger"
import { createSupplierLink, deleteSupplierLink } from "@/lib/services/ti/supplier-links"
import { itSupplierLinkSchema } from "@/lib/validation/ti"
import type { ActionState } from "@/lib/validation/masters"

export async function createSupplierLinkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_assets") }
  catch { return { ok: false, message: "Sin permisos para vincular proveedores" } }

  const parsed = parseZ(itSupplierLinkSchema, {
    supplierId: formData.get("supplierId"),
    category: formData.get("category"),
    notes: formData.get("notes"),
  }, "Revisa los datos del vínculo")
  if (!parsed.ok) return parsed

  try {
    await createSupplierLink(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/ti/garantias")
    return { ok: true, message: "Proveedor vinculado como TI" }
  } catch (error) {
    logger.error("[ti:createSupplierLink]", error)
    return { ok: false, message: safeActionMessage(error, "Error al vincular el proveedor") }
  }
}

export async function deleteSupplierLinkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_assets") }
  catch { return { ok: false, message: "Sin permisos" } }

  const linkId = String(formData.get("linkId") ?? "")
  if (!linkId) return { ok: false, message: "Vínculo no especificado" }

  try {
    await deleteSupplierLink(linkId, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/ti/garantias")
    return { ok: true, message: "Vínculo eliminado" }
  } catch (error) {
    logger.error("[ti:deleteSupplierLink]", error)
    return { ok: false, message: safeActionMessage(error, "Error al eliminar el vínculo") }
  }
}

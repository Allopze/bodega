"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequestItems } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { approveItem, rejectItem, returnItem } from "@/lib/services/item-state"
import { notifySafe } from "@/lib/services/notifications"
import type { ActionState } from "@/lib/validation/operations"

const REVALIDATE = "/aprobaciones"

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRoleContext(roles: string[]): string {
  if (roles.includes("administrador")) return "admin"
  if (roles.includes("jefa_chome"))    return "jefa_chome"
  if (roles.includes("secretaria"))    return "secretaria"
  if (roles.includes("prevencionista")) return "prevencionista"
  return roles[0] ?? "unknown"
}

// ── Approve item ──────────────────────────────────────────────────────────────

export async function approveItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("approvals:approve") }
  catch { return { ok: false, message: "Sin permisos para aprobar ítems" } }

  const itemId = formData.get("itemId") as string | null
  if (!itemId) return { ok: false, message: "Ítem no especificado" }

  const modifiedQtyRaw = formData.get("modifiedQty") as string | null
  const modifiedQty    = modifiedQtyRaw ? parseFloat(modifiedQtyRaw) : undefined

  if (modifiedQty !== undefined && (isNaN(modifiedQty) || modifiedQty <= 0)) {
    return { ok: false, message: "Cantidad modificada debe ser un número positivo" }
  }

  try {
    // Load item before service call to get requester info for notification
    const itemBefore = await db.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
      with: { request: { columns: { id: true, code: true, requesterId: true } } },
    })

    await approveItem(itemId, session.user.id, {
      modifiedQty,
      userEmail:   session.user.email ?? undefined,
      roleContext: getRoleContext(session.user.roles),
    })
    revalidatePath(REVALIDATE)

    // Notify requester (fire-and-forget)
    if (itemBefore?.request?.requesterId) {
      void notifySafe({
        userId:     itemBefore.request.requesterId,
        type:       "request_approved",
        title:      `Ítem aprobado en ${itemBefore.request.code}`,
        body:       modifiedQty
          ? `Aprobado con cantidad modificada a ${modifiedQty}`
          : `Aprobado por ${session.user.name ?? session.user.email}`,
        entityType: "purchase_request",
        entityId:   itemBefore.request.id,
        entityHref: `/solicitudes/${itemBefore.request.id}`,
      })
    }

    return { ok: true, message: "Ítem aprobado" }
  } catch (e) {
    console.error("[approveItemAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al aprobar ítem" }
  }
}

// ── Reject item ───────────────────────────────────────────────────────────────

export async function rejectItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("approvals:approve") }
  catch { return { ok: false, message: "Sin permisos para rechazar ítems" } }

  const itemId = formData.get("itemId") as string | null
  const reason = (formData.get("reason") as string | null)?.trim()

  if (!itemId) return { ok: false, message: "Ítem no especificado" }
  if (!reason) return { ok: false, message: "El motivo de rechazo es obligatorio" }

  try {
    const itemBefore = await db.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
      with: { request: { columns: { id: true, code: true, requesterId: true } } },
    })

    await rejectItem(itemId, session.user.id, reason, {
      userEmail:   session.user.email ?? undefined,
      roleContext: getRoleContext(session.user.roles),
    })
    revalidatePath(REVALIDATE)

    // Notify requester (fire-and-forget)
    if (itemBefore?.request?.requesterId) {
      void notifySafe({
        userId:     itemBefore.request.requesterId,
        type:       "request_rejected",
        title:      `Ítem rechazado en ${itemBefore.request.code}`,
        body:       reason,
        entityType: "purchase_request",
        entityId:   itemBefore.request.id,
        entityHref: `/solicitudes/${itemBefore.request.id}`,
      })
    }

    return { ok: true, message: "Ítem rechazado" }
  } catch (e) {
    console.error("[rejectItemAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al rechazar ítem" }
  }
}

// ── Return item ───────────────────────────────────────────────────────────────

export async function returnItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("approvals:approve") }
  catch { return { ok: false, message: "Sin permisos para devolver ítems" } }

  const itemId = formData.get("itemId") as string | null
  const reason = (formData.get("reason") as string | null)?.trim()

  if (!itemId) return { ok: false, message: "Ítem no especificado" }
  if (!reason) return { ok: false, message: "Las observaciones son obligatorias para devolver un ítem" }

  try {
    await returnItem(itemId, session.user.id, reason, {
      userEmail:   session.user.email ?? undefined,
      roleContext: getRoleContext(session.user.roles),
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Ítem devuelto al solicitante" }
  } catch (e) {
    console.error("[returnItemAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al devolver ítem" }
  }
}

// ── Bulk approve all pending items in a request ───────────────────────────────

export async function bulkApproveRequestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("approvals:approve") }
  catch { return { ok: false, message: "Sin permisos para aprobar ítems" } }

  const itemIds = (formData.get("itemIds") as string | null)?.split(",").filter(Boolean)
  if (!itemIds?.length) return { ok: false, message: "No hay ítems para aprobar" }

  const roleContext = getRoleContext(session.user.roles)
  let approved = 0
  const errors: string[] = []

  for (const id of itemIds) {
    try {
      await approveItem(id, session.user.id, {
        userEmail:   session.user.email ?? undefined,
        roleContext,
      })
      approved++
    } catch (e) {
      errors.push(id)
      console.error(`[bulkApproveRequestAction] item ${id}:`, e)
    }
  }

  revalidatePath(REVALIDATE)

  if (errors.length > 0) {
    return {
      ok:      false,
      message: `${approved} ítem(s) aprobado(s), ${errors.length} con error`,
    }
  }
  return { ok: true, message: `${approved} ítem(s) aprobado(s)` }
}

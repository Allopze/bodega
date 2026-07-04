"use server"

import { revalidatePath } from "next/cache"
import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequestItems } from "@/db/schema"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { approveItem, rejectItem, returnItem } from "@/lib/services/item-state"
import { notifySafe, notifyAfterCommit } from "@/lib/services/notifications"
import { logger } from "@/lib/logger"
import type { ActionState } from "@/lib/validation/operations"

const REVALIDATE = "/aprobaciones"

// ── Helpers ───────────────────────────────────────────────────────────────────

const EPP_APPROVER_ROLES = new Set(["administrador", "jefa_chome", "secretaria", "prevencionista"])

function canApproveEpp(roles: string[]): boolean {
  return roles.some((r) => EPP_APPROVER_ROLES.has(r))
}

function getRoleContext(roles: string[]): string {
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
  const reason         = (formData.get("reason") as string | null)?.trim() || undefined

  if (modifiedQty !== undefined && (isNaN(modifiedQty) || modifiedQty <= 0)) {
    return { ok: false, message: "Cantidad modificada debe ser un número positivo" }
  }
  if (modifiedQty !== undefined && !reason) {
    return { ok: false, message: "Se requiere un motivo al modificar la cantidad aprobada" }
  }

  try {
    // Load item before service call to get requester info for notification
    const itemBefore = await db.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
      with: { request: { columns: { id: true, code: true, requesterId: true, worksiteId: true, requestType: true } } },
    })
    if (!itemBefore) return { ok: false, message: "Ítem no encontrado" }
    if (!canAccessWorksite(session, itemBefore.request.worksiteId)) {
      return { ok: false, message: "No tienes acceso a la faena de este ítem" }
    }
    if (itemBefore.request.requestType === "epp" && !canApproveEpp(session.user.roles)) {
      return { ok: false, message: "Las solicitudes de EPP solo pueden ser aprobadas por Jefatura, Secretaría o Prevención" }
    }

    await approveItem(itemId, session.user.id, {
      modifiedQty,
      reason,
      userEmail:   session.user.email ?? undefined,
      roleContext: getRoleContext(session.user.roles),
    })
    revalidatePath(REVALIDATE)

    // S-05: notify only after the approveItem transaction has committed.
    if (itemBefore?.request?.requesterId) {
      const requesterId = itemBefore.request.requesterId
      const requestId   = itemBefore.request.id
      const requestCode = itemBefore.request.code
      const approver    = session.user.name ?? session.user.email ?? ""
      notifyAfterCommit(() => notifySafe({
        userId:     requesterId,
        type:       "request_approved",
        title:      `Ítem aprobado en ${requestCode}`,
        body:       modifiedQty
          ? `Aprobado con cantidad modificada a ${modifiedQty}`
          : `Aprobado por ${approver}`,
        entityType: "purchase_request",
        entityId:   requestId,
        entityHref: `/solicitudes/${requestId}`,
      }))
    }

    return { ok: true, message: "Ítem aprobado" }
  } catch (e) {
    logger.error("[approveItemAction]", e)
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
      with: { request: { columns: { id: true, code: true, requesterId: true, worksiteId: true, requestType: true } } },
    })
    if (!itemBefore) return { ok: false, message: "Ítem no encontrado" }
    if (!canAccessWorksite(session, itemBefore.request.worksiteId)) {
      return { ok: false, message: "No tienes acceso a la faena de este ítem" }
    }
    if (itemBefore.request.requestType === "epp" && !canApproveEpp(session.user.roles)) {
      return { ok: false, message: "Las solicitudes de EPP solo pueden ser gestionadas por Jefatura, Secretaría o Prevención" }
    }

    await rejectItem(itemId, session.user.id, reason, {
      userEmail:   session.user.email ?? undefined,
      roleContext: getRoleContext(session.user.roles),
    })
    revalidatePath(REVALIDATE)

    // S-05: notify only after the rejectItem transaction has committed.
    if (itemBefore?.request?.requesterId) {
      const requesterId = itemBefore.request.requesterId
      const requestId   = itemBefore.request.id
      const requestCode = itemBefore.request.code
      notifyAfterCommit(() => notifySafe({
        userId:     requesterId,
        type:       "request_rejected",
        title:      `Ítem rechazado en ${requestCode}`,
        body:       reason,
        entityType: "purchase_request",
        entityId:   requestId,
        entityHref: `/solicitudes/${requestId}`,
      }))
    }

    return { ok: true, message: "Ítem rechazado" }
  } catch (e) {
    logger.error("[rejectItemAction]", e)
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
    const itemBefore = await db.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
      with: { request: { columns: { worksiteId: true, requestType: true } } },
    })
    if (!itemBefore) return { ok: false, message: "Ítem no encontrado" }
    if (!canAccessWorksite(session, itemBefore.request.worksiteId)) {
      return { ok: false, message: "No tienes acceso a la faena de este ítem" }
    }
    if (itemBefore.request.requestType === "epp" && !canApproveEpp(session.user.roles)) {
      return { ok: false, message: "Las solicitudes de EPP solo pueden ser gestionadas por Jefatura, Secretaría o Prevención" }
    }

    await returnItem(itemId, session.user.id, reason, {
      userEmail:   session.user.email ?? undefined,
      roleContext: getRoleContext(session.user.roles),
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Ítem devuelto al solicitante" }
  } catch (e) {
    logger.error("[returnItemAction]", e)
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
  const userCanApproveEpp = canApproveEpp(session.user.roles)
  let approved = 0
  const errors: string[] = []
  const scopedItems = await db.query.purchaseRequestItems.findMany({
    where: inArray(purchaseRequestItems.id, itemIds),
    with: { request: { columns: { worksiteId: true, requestType: true } } },
  })
  const allowedItemIds = new Set(
    scopedItems
      .filter((item) => {
        if (!canAccessWorksite(session, item.request.worksiteId)) return false
        if (item.request.requestType === "epp" && !userCanApproveEpp) return false
        return true
      })
      .map((item) => item.id),
  )

  for (const id of itemIds) {
    if (!allowedItemIds.has(id)) {
      errors.push(id)
      continue
    }
    try {
      await approveItem(id, session.user.id, {
        userEmail:   session.user.email ?? undefined,
        roleContext,
      })
      approved++
    } catch (e) {
      errors.push(id)
      logger.error(`[bulkApproveRequestAction] item ${id}:`, e)
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

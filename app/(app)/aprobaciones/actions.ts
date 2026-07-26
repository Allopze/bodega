"use server"

import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { approveItem, bulkApproveItems, rejectItem, returnItem } from "@/lib/services/item-state"
import { notifySafe, notifyAfterCommit } from "@/lib/services/notifications"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import type { ActionState } from "@/lib/validation/operations"
import { canApproveEpp, DISPATCH_DECIDER_ROLES } from "./roles"

const REVALIDATE = "/aprobaciones"

// ── Helpers ───────────────────────────────────────────────────────────────────
// Los conjuntos de roles (EPP / despacho) viven en ./roles para ser compartidos
// con page.tsx y evitar divergencias UI↔backend (ver H-1).

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
    revalidateOperationalViews([REVALIDATE, `/solicitudes/${itemBefore.request.id}`])

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
    revalidateOperationalViews([REVALIDATE, `/solicitudes/${itemBefore.request.id}`])

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
    revalidateOperationalViews([REVALIDATE])
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

  const filtered = itemIds.filter((id) => allowedItemIds.has(id))
  const skipped = itemIds.filter((id) => !allowedItemIds.has(id))

  const { approved, errors: approveErrors } = await bulkApproveItems(filtered, session.user.id, {
    userEmail: session.user.email ?? undefined,
    roleContext,
  })

  revalidateOperationalViews([REVALIDATE])

  const totalErrors = skipped.length + approveErrors.length
  if (totalErrors > 0) {
    return {
      ok:      false,
      message: `${approved} ítem(s) aprobado(s), ${totalErrors} con error`,
    }
  }
  return { ok: true, message: `${approved} ítem(s) aprobado(s)` }
}

// ── Set delivery mode (dispatch route) on a request ───────────────────────────

export async function updateDeliveryModeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("approvals:approve") }
  catch { return { ok: false, message: "Sin permisos" } }

  if (!session.user.roles.some((r) => DISPATCH_DECIDER_ROLES.has(r))) {
    return { ok: false, message: "Solo Secretaría o Jefatura pueden definir el modo de despacho" }
  }

  const requestId = formData.get("requestId") as string | null
  const mode      = formData.get("mode") as string | null
  if (!requestId) return { ok: false, message: "Solicitud no especificada" }
  if (mode !== "via_oficina" && mode !== "directo_faena") {
    return { ok: false, message: "Modo de despacho inválido" }
  }

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
    columns: { id: true, worksiteId: true },
    with: { items: { columns: { status: true } } },
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
  }

  const hasPurchasedItems = (request.items ?? []).some((i) =>
    ["in_purchase_order", "purchased", "partially_received", "received"].includes(i.status),
  )
  if (hasPurchasedItems) {
    return { ok: false, message: "No se puede cambiar el modo de despacho porque esta solicitud ya posee ítems en Orden de Compra" }
  }

  await db.update(purchaseRequests).set({ deliveryMode: mode }).where(eq(purchaseRequests.id, requestId))
  revalidateOperationalViews([REVALIDATE, `/solicitudes/${requestId}`])
  return {
    ok: true,
    message: mode === "directo_faena" ? "Despacho directo a faena" : "Despacho vía oficina",
  }
}

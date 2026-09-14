"use server"

import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { approveItem, bulkApproveItems, rejectItem } from "@/lib/services/item-state"
import { notifySafe, notifyAfterCommit } from "@/lib/services/notifications"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import type { ActionState } from "@/lib/validation/operations"
import { canApproveEpp, DISPATCH_DECIDER_ROLES } from "./roles"
import { safeActionMessage } from "@/lib/action-error"

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
    if (["repuestos", "servicios"].includes(itemBefore.request.requestType)) {
      return { ok: false, message: "Los ítems de repuestos y servicios se aprueban seleccionando la cotización ganadora, no ítem a ítem" }
    }
    if (modifiedQty !== undefined && modifiedQty > itemBefore.quantity) {
      return { ok: false, message: `La cantidad modificada no puede superar la cantidad solicitada (${itemBefore.quantity})` }
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
    return { ok: false, message: safeActionMessage(e, "Error al aprobar ítem") }
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
    if (["repuestos", "servicios"].includes(itemBefore.request.requestType)) {
      return { ok: false, message: "Los ítems de repuestos y servicios se gestionan seleccionando la cotización ganadora, no ítem a ítem" }
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
    return { ok: false, message: safeActionMessage(e, "Error al rechazar ítem") }
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
  // Cota antes de cualquier consulta: sin ella, un POST con decenas de miles de
  // ids armaba un `inArray` gigante antes de validar nada. Una tanda real de
  // aprobación no pasa de unas pocas decenas.
  if (itemIds.length > 200) {
    return { ok: false, message: "Demasiados ítems en una sola tanda (máximo 200)" }
  }
  const uniqueItemIds = [...new Set(itemIds)]
  if (uniqueItemIds.length !== itemIds.length) {
    return { ok: false, message: "La selección contiene ítems duplicados" }
  }

  const roleContext = getRoleContext(session.user.roles)
  const userCanApproveEpp = canApproveEpp(session.user.roles)

  const scopedItems = await db.query.purchaseRequestItems.findMany({
    where: inArray(purchaseRequestItems.id, uniqueItemIds),
    with: { request: { columns: { worksiteId: true, requestType: true } } },
  })
  if (scopedItems.length !== uniqueItemIds.length) {
    return { ok: false, message: "Uno o más ítems ya no están disponibles para aprobar" }
  }
  if (scopedItems.some((item) =>
    !canAccessWorksite(session, item.request.worksiteId)
    || (item.request.requestType === "epp" && !userCanApproveEpp)
    || ["repuestos", "servicios"].includes(item.request.requestType),
  )) {
    return { ok: false, message: "No tienes permiso para aprobar todos los ítems seleccionados" }
  }

  let approved: number
  try {
    ({ approved } = await bulkApproveItems(uniqueItemIds, session.user.id, {
      userEmail: session.user.email ?? undefined,
      roleContext,
      // APR-002: el nombre del aprobador viaja al servicio porque el aviso al
      // solicitante ahora se arma allí dentro de la transacción, igual que en
      // la aprobación individual.
      approverName: session.user.name ?? session.user.email ?? undefined,
    }))
  } catch (error) {
    logger.error("[bulkApproveRequestAction]", error)
    return { ok: false, message: safeActionMessage(error, "No se pudieron aprobar los ítems") }
  }

  revalidateOperationalViews([REVALIDATE])
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
  // APR-001: el motivo se acepta pero no se exige. Que cambiar el destino
  // logístico requiera justificación escrita es una política comercial que la
  // plataforma no declara en ninguna parte, así que no la inventamos aquí.
  const reason    = (formData.get("reason") as string | null)?.trim() || undefined
  if (!requestId) return { ok: false, message: "Solicitud no especificada" }
  if (mode !== "via_oficina" && mode !== "directo_faena") {
    return { ok: false, message: "Modo de despacho inválido" }
  }

  try {
    await db.transaction(async (tx) => {
      const [request] = await tx
        .select({
          id:           purchaseRequests.id,
          code:         purchaseRequests.code,
          worksiteId:   purchaseRequests.worksiteId,
          // APR-001: el valor anterior se lee bajo el mismo lock que la
          // escritura; leerlo fuera dejaría abierta la carrera que haría
          // mentir a la traza.
          deliveryMode: purchaseRequests.deliveryMode,
        })
        .from(purchaseRequests)
        .where(eq(purchaseRequests.id, requestId))
        .for("update")

      if (!request) throw new Error("Solicitud no encontrada")
      if (!canAccessWorksite(session, request.worksiteId)) {
        throw new Error("No tienes acceso a la faena de esta solicitud")
      }

      const items = await tx
        .select({ status: purchaseRequestItems.status })
        .from(purchaseRequestItems)
        .where(eq(purchaseRequestItems.requestId, requestId))

      const hasPurchasedItems = items.some((i) =>
        ["in_purchase_order", "purchased", "partially_received", "received", "partially_delivered", "delivered"].includes(i.status),
      )
      if (hasPurchasedItems) {
        throw new Error("No se puede cambiar el modo de despacho porque esta solicitud ya posee ítems en Orden de Compra")
      }

      /*
       * APR-001 (auditoría 2026-09-14): el cambio de modo de despacho sólo
       * hacía `set({ deliveryMode })`. No dejaba fila en `status_history`, ni
       * en `audit_log`, ni movía `updatedAt`: ante una discrepancia de
       * recepción o una OC dirigida al flujo equivocado no había forma de
       * decir quién cambió el destino, cuándo ni desde qué modo. Y el modo se
       * propaga: Compras lo copia a la OC al crearla.
       *
       * Un cambio que no cambia nada no se audita: registrar un evento por
       * cada re-selección del mismo valor sólo ensucia el historial.
       */
      const previousMode = request.deliveryMode
      if (previousMode === mode) return

      const now = new Date().toISOString()
      await tx
        .update(purchaseRequests)
        .set({ deliveryMode: mode, updatedAt: now })
        .where(eq(purchaseRequests.id, requestId))

      // Se escribe como `purchase_request` porque es el único `entityType` que
      // la ficha de la solicitud consulta; los valores from/to son los modos,
      // que la línea de tiempo rotula aparte de los estados de la solicitud.
      await recordStatusChange({
        entityType: "purchase_request",
        entityId:   requestId,
        fromStatus: previousMode,
        toStatus:   mode,
        changedBy:  session.user.id,
        reason,
      }, tx)

      await recordAudit({
        userId:     session.user.id,
        userEmail:  session.user.email ?? undefined,
        action:     "update",
        entityType: "purchase_request",
        entityId:   requestId,
        entityCode: request.code ?? undefined,
        oldState:   { deliveryMode: previousMode },
        newState:   { deliveryMode: mode },
        reason,
      }, tx)
    })
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "Error al cambiar el modo de despacho") }
  }

  revalidateOperationalViews([REVALIDATE, `/solicitudes/${requestId}`])
  return {
    ok: true,
    message: mode === "directo_faena" ? "Despacho directo a faena" : "Despacho vía oficina",
  }
}

/**
 * Label functions and status constants for the work-queue module.
 */
import type { WorkPriority } from "./work-queue.types"

export const STAGES = ["Solicitado", "Aprobación", "Compra", "Recepción", "Entrega"]
export const CLOSED_REQUEST_STATUSES = new Set(["closed", "cancelled", "rejected"])
export const ACTIVE_REQUEST_STATUSES = new Set([
  "draft", "submitted", "in_review", "partially_approved",
  "approved", "returned", "in_purchasing",
])
export const APPROVAL_ITEM_STATUSES = new Set(["requested"])
export const PURCHASE_ITEM_STATUSES = new Set(["approved", "pending_purchase"])
export const DELIVERY_ITEM_STATUSES = new Set(["partially_received", "received", "partially_delivered"])
export const OFFICE_RECEIVABLE_STATUSES = new Set(["sent", "partially_office_received"])
export const FAENA_RECEIVABLE_STATUSES = new Set(["partially_office_received", "office_received", "partially_received"])
export const DIRECT_FAENA_RECEIVABLE_STATUSES = new Set(["sent", "partially_received"])

export const PRIORITY_RANK: Record<WorkPriority, number> = {
  critical: 0,
  high:     1,
  normal:   2,
  low:      3,
}

export function requestStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft:              "Borrador",
    submitted:          "Esperando revisión",
    in_review:          "En aprobación",
    partially_approved: "Aprobación parcial",
    approved:           "Aprobada para compra",
    rejected:           "Rechazada",
    returned:           "Requiere corrección",
    in_purchasing:      "En compra",
    closed:             "Cerrada",
    cancelled:          "Cancelada",
  }
  return labels[status] ?? status
}

export function itemStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft:               "Borrador",
    requested:           "Esperando aprobación",
    approved:            "Aprobado para compra",
    rejected:            "Rechazado",
    returned:            "Devuelto para corregir",
    postponed:           "Postergado",
    pending_purchase:    "Aprobado para compra",
    in_purchase_order:   "Incluido en OC",
    purchased:           "Comprado",
    partially_received:  "Recepción parcial",
    received:            "Recibido",
    partially_delivered: "Entrega parcial",
    delivered:           "Entregado",
  }
  return labels[status] ?? status
}

export function itemStageLabel(status: string): string {
  if (["draft"].includes(status)) return "Solicitado"
  if (["requested", "returned", "rejected"].includes(status)) return "Aprobación"
  if (["approved", "pending_purchase", "postponed", "in_purchase_order", "purchased"].includes(status)) return "Compra"
  if (["partially_received", "received"].includes(status)) return "Recepción"
  if (["partially_delivered", "delivered"].includes(status)) return "Entrega"
  return "Solicitado"
}

export function requestNextAction(requestStatus: string, statuses: string[]): string {
  if (requestStatus === "cancelled") return "Solicitud cancelada."
  if (statuses.length === 0) return "Agrega ítems para enviar la solicitud."
  if (statuses.every((status) => status === "delivered")) return "Pedido entregado en faena."
  if (statuses.every((status) => status === "rejected")) return "Solicitud cerrada sin ítems aprobados."
  if (statuses.some((status) => status === "returned")) return "Corrige los ítems devueltos y vuelve a enviar."
  if (statuses.some((status) => status === "draft")) return "Envía la solicitud a aprobación."
  if (statuses.some((status) => status === "requested")) return "Aprobación debe revisar los ítems pendientes."
  if (statuses.some((status) => ["approved", "pending_purchase", "postponed"].includes(status))) return "El módulo de órdenes de compra debe generar la orden de compra."
  if (statuses.some((status) => status === "in_purchase_order")) return "El módulo de órdenes de compra debe emitir y enviar la OC al proveedor."
  if (statuses.some((status) => ["purchased", "partially_received"].includes(status))) return "Esperando recepción en oficina o bodega."
  if (statuses.some((status) => ["received", "partially_delivered"].includes(status))) return "Bodega debe registrar la entrega a faena."
  if (CLOSED_REQUEST_STATUSES.has(requestStatus)) return "La solicitud ya no requiere acciones."
  return "Revisa el detalle para ver el siguiente paso."
}

export function requestCurrentStage(requestStatus: string, statuses: string[]): string {
  if (requestStatus === "draft") return "Solicitado"
  if (statuses.some((status) => ["requested", "returned", "rejected"].includes(status))) return "Aprobación"
  if (statuses.some((status) => ["approved", "pending_purchase", "postponed", "in_purchase_order", "purchased"].includes(status))) return "Compra"
  if (statuses.some((status) => ["partially_received", "received"].includes(status))) return "Recepción"
  if (statuses.some((status) => ["partially_delivered", "delivered"].includes(status))) return "Entrega"
  return requestStatus === "closed" ? "Entrega" : "Solicitado"
}

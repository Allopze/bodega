/**
 * Label functions and status constants for the work-queue module.
 */
import type { OperationalModule, WorkPriority } from "./work-queue.types"
import { REQUEST_STATE_META, ITEM_STATE_META } from "@/components/states/state-badge"

/** Rótulo visible de cada módulo de la cola operacional. */
export const OPERATIONAL_MODULE_LABELS: Record<OperationalModule, string> = {
  solicitudes:   "Solicitudes",
  aprobaciones:  "Aprobaciones",
  compras:       "Compras",
  recepciones:   "Recepciones",
  entregas:      "Entregas",
  pdtp:          "PDTP",
  capa:          "CAPA",
  inspecciones:  "Inspecciones",
  documentacion: "Documentación",
  ppa:           "PPA",
  sst:           "SST",
}

export const STAGES = ["Solicitado", "Aprobación", "Compra", "Recepción", "Entrega"]
export const CLOSED_REQUEST_STATUSES = new Set(["closed", "cancelled", "rejected"])
export const ACTIVE_REQUEST_STATUSES = new Set([
  "draft", "submitted", "in_review", "partially_approved",
  "approved", "in_purchasing",
])
export const APPROVAL_ITEM_STATUSES = new Set(["requested"])
export const PURCHASE_ITEM_STATUSES = new Set(["approved", "pending_purchase"])
/** Ítem ya comprado que espera llegada — el par de item de una OC recibible. */
export const RECEIVE_ITEM_STATUSES = new Set(["purchased", "partially_received"])
export const DELIVERY_ITEM_STATUSES = new Set(["partially_received", "received", "partially_delivered"])
export const OFFICE_RECEIVABLE_STATUSES = new Set(["sent", "partially_office_received"])
export const FAENA_RECEIVABLE_STATUSES = new Set(["partially_office_received", "office_received", "partially_received"])
export const DIRECT_FAENA_RECEIVABLE_STATUSES = new Set(["sent", "partially_received"])
/**
 * Unión de las tres anteriores: los estados de OC en que `/recepcion` acepta
 * registrar algo. Estaba escrita a mano en la lista, en el formulario y ahora
 * también en el CTA de la solicitud; una sola definición evita que un cuarto
 * consumidor ofrezca un enlace que el destino rechaza.
 */
export const RECEIVABLE_ORDER_STATUSES = [
  "sent", "partially_office_received", "office_received", "partially_received",
]

/**
 * Estados de OC en que ya se exige la factura: llegó mercadería, así que el
 * documento tributario debería existir. Antes de recibir nada, exigirla sería
 * ruido; una vez cerrada, la OC ya no admite trabajo pendiente. Compartido por
 * la cola operacional, su badge y el filtro del listado de compras para que las
 * tres cuenten lo mismo.
 */
export const INVOICE_DUE_ORDER_STATUSES = [
  "partially_office_received", "office_received", "partially_received", "received",
]

export const PRIORITY_RANK: Record<WorkPriority, number> = {
  critical: 0,
  high:     1,
  normal:   2,
  low:      3,
}

// Etiquetas leídas del vocabulario canónico de StateBadge — antes este archivo
// mantenía su propio diccionario y divergía del badge (mismo estado, dos textos
// distintos en pantalla). Una sola fuente de verdad.
export function requestStatusLabel(status: string): string {
  return REQUEST_STATE_META[status as keyof typeof REQUEST_STATE_META]?.label ?? status
}

export function itemStatusLabel(status: string): string {
  return ITEM_STATE_META[status as keyof typeof ITEM_STATE_META]?.label ?? status
}

export function itemStageLabel(status: string): string {
  if (["draft"].includes(status)) return "Solicitado"
  if (["requested", "rejected"].includes(status)) return "Aprobación"
  if (["approved", "pending_purchase", "in_purchase_order", "purchased"].includes(status)) return "Compra"
  if (["partially_received", "received"].includes(status)) return "Recepción"
  if (["partially_delivered", "delivered"].includes(status)) return "Entrega"
  return "Solicitado"
}

export function requestNextAction(requestStatus: string, statuses: string[]): string {
  if (requestStatus === "cancelled") return "Solicitud cancelada."
  if (statuses.length === 0) return "Agrega ítems para enviar la solicitud."
  if (statuses.every((status) => status === "delivered")) return "Pedido entregado en faena."
  if (statuses.every((status) => status === "rejected")) return "Solicitud cerrada sin ítems aprobados."
  if (statuses.some((status) => status === "draft")) return "Adjunta las cotizaciones y envía la solicitud a aprobación."
  if (statuses.some((status) => status === "requested")) return "Aprobación debe revisar los ítems pendientes."
  // A-17: nombraban un módulo en lugar de un siguiente paso, y la pantalla no
  // ofrecía cómo continuar. El CTA ya está al lado; el texto dice qué falta.
  if (statuses.some((status) => ["approved", "pending_purchase"].includes(status))) return "Ítems aprobados y a la espera de una orden de compra."
  if (statuses.some((status) => status === "in_purchase_order")) return "En una orden de compra, pendiente de emitir y enviar al proveedor."
  if (statuses.some((status) => ["purchased", "partially_received"].includes(status))) return "Esperando recepción en oficina o bodega."
  if (statuses.some((status) => ["received", "partially_delivered"].includes(status))) return "Bodega debe registrar la entrega a faena."
  if (CLOSED_REQUEST_STATUSES.has(requestStatus)) return "La solicitud ya no requiere acciones."
  return "Revisa el detalle para ver el siguiente paso."
}

export function requestCurrentStage(requestStatus: string, statuses: string[]): string {
  if (requestStatus === "draft") return "Solicitado"
  if (statuses.some((status) => ["requested", "rejected"].includes(status))) return "Aprobación"
  if (statuses.some((status) => ["approved", "pending_purchase", "in_purchase_order", "purchased"].includes(status))) return "Compra"
  if (statuses.some((status) => ["partially_received", "received"].includes(status))) return "Recepción"
  if (statuses.some((status) => ["partially_delivered", "delivered"].includes(status))) return "Entrega"
  return requestStatus === "closed" ? "Entrega" : "Solicitado"
}

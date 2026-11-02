import type { OtEventType, OtStatus } from "@/lib/mantencion/work-order-states"
import { OT_STATUS_LABELS, OT_STATUS_TONES } from "@/lib/mantencion/work-order-states"
import type { StateMetaInput } from "@/components/states/state-badge"

/** `{ label, variant }` de cada estado de la OT, de la fuente única `work-order-states.ts`. */
export const OT_STATE_META: Record<OtStatus, StateMetaInput> = Object.fromEntries(
  (Object.keys(OT_STATUS_LABELS) as OtStatus[]).map((status) => [status, { label: OT_STATUS_LABELS[status], variant: OT_STATUS_TONES[status] }]),
) as Record<OtStatus, StateMetaInput>

/** Qué dice cada evento en la línea de tiempo (el historial no muestra el valor crudo del enum: regla A6). */
export const OT_EVENT_LABELS: Record<OtEventType, string> = {
  created: "OT solicitada",
  edited: "Solicitud editada",
  assigned: "Mecánico asignado",
  unassigned: "Asignación retirada",
  taken: "Tomada por el mecánico",
  started: "Ingreso a taller",
  entry_updated: "Ingreso a taller corregido",
  estimate_changed: "Entrega estimada cambiada",
  item_added: "Ítem agregado en taller",
  items_marked: "Ítems marcados",
  finished: "Salida de taller",
  received: "Recepción",
  rejected: "Rechazada",
  conformed: "Recepción en faena (conformidad)",
  voided: "OT anulada",
  reopened: "OT reabierta",
  record_linked: "Registro de mantención enlazado",
}

/** REPARACIÓN / MANTENCIÓN / ambas, como se marca en el talonario. */
export function workOrderTypeText(order: { repair: boolean; maintenance: boolean }): string {
  if (order.repair && order.maintenance) return "Reparación y mantención"
  return order.repair ? "Reparación" : "Mantención"
}

/** `KA-135 · RBYD-98` (sin repetir cuando la patente es el código). */
export function equipmentText(order: { equipmentCode: string; equipmentPlate: string }): string {
  return order.equipmentPlate && order.equipmentPlate !== order.equipmentCode
    ? `${order.equipmentCode} · ${order.equipmentPlate}`
    : order.equipmentCode
}

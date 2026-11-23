import { ACTION_TYPE_LABELS, SPECIALTY_LABELS, type ActionTypeOrUnknown, type Specialty } from "@/lib/mantencion/action-type"
import type { OtEventType, OtStatus } from "@/lib/mantencion/work-order-states"
import { OT_STATUS_LABELS, OT_STATUS_TONES } from "@/lib/mantencion/work-order-states"
import type { StateMetaInput } from "@/components/states/state-badge"

/** `{ label, variant }` de cada estado de la OT, de la fuente única `work-order-states.ts`. */
export const OT_STATE_META: Record<OtStatus, StateMetaInput> = Object.fromEntries(
  (Object.keys(OT_STATUS_LABELS) as OtStatus[]).map((status) => [status, { label: OT_STATUS_LABELS[status], variant: OT_STATUS_TONES[status] }]),
) as Record<OtStatus, StateMetaInput>

/** Qué dice cada evento en la línea de tiempo (el historial no muestra el valor crudo del enum: regla A6). */
export const OT_EVENT_LABELS: Record<OtEventType, string> = {
  created: "Orden solicitada",
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
  received: "Equipo recibido",
  rejected: "Rechazada",
  conformed: "Conformidad en faena",
  voided: "Orden anulada",
  reopened: "Orden reabierta",
  record_linked: "Registro firmado enlazado",
}

/**
 * Rótulo del evento en el historial. Una corrección de clasificación se guarda como `edited` con
 * `changeSet.scope === "clasificacion"` (el CHECK de la tabla no admite tipos nuevos) y se lee distinto de
 * «Solicitud editada».
 */
export function otEventLabel(event: { type: OtEventType; changeSet?: Record<string, unknown> | null }): string {
  if (event.type === "edited" && event.changeSet?.scope === "clasificacion") return "Clasificación corregida"
  return OT_EVENT_LABELS[event.type] ?? event.type
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

/** Tipo de acción de la OT; «No informado» cuando no se puede saber (OT anteriores sin casillas claras). */
export function actionTypeText(type: ActionTypeOrUnknown): string {
  return type === "sin_clasificar" ? "No informado" : ACTION_TYPE_LABELS[type]
}

/** «Mecánica, Soldadura»; «—» sin especialidades. */
export function specialtiesText(specialties: readonly Specialty[]): string {
  return specialties.length ? specialties.map((specialty) => SPECIALTY_LABELS[specialty]).join(", ") : "—"
}

/** Horas hombre con coma decimal; «—» si no se informaron. */
export function laborHoursText(hours: number | null): string {
  return hours == null ? "—" : `${hours.toLocaleString("es-CL", { maximumFractionDigits: 2 })} h`
}

/** Días detenido: «3 días», «1 día», «Mismo día»; «—» mientras falte la salida. */
export function daysStoppedText(days: number | null): string {
  if (days == null) return "—"
  if (days === 0) return "Mismo día"
  return `${days} ${days === 1 ? "día" : "días"}`
}

/**
 * Máquina de estados de la orden de trabajo (OT), sin BD ni Node: la usan el
 * servidor, la jefatura y la app del mecánico con las mismas reglas.
 *
 * Calcada del talonario «Orden de Trabajo Reparación/Mantención»:
 *
 *   solicitada → asignada → en_ejecucion → trabajo_terminado → recepcionada → cerrada
 *
 * - «Ingreso a taller» lleva de asignada a en_ejecucion.
 * - «Salida taller» lleva de en_ejecucion a trabajo_terminado.
 * - «Recepción» la registra quien retira el equipo del taller.
 * - «Recepción en faena» es la conformidad del administrador de contrato y
 *   cierra la OT.
 * - Un rechazo en cualquiera de las dos recepciones devuelve la OT a
 *   en_ejecucion con el mismo mecánico.
 */

export const OT_STATUSES = [
  "solicitada",
  "asignada",
  "en_ejecucion",
  "trabajo_terminado",
  "recepcionada",
  "cerrada",
  "anulada",
] as const
export type OtStatus = (typeof OT_STATUSES)[number]

/** Abiertas = todo lo que no está cerrado ni anulado. */
export const OT_OPEN_STATUSES = ["solicitada", "asignada", "en_ejecucion", "trabajo_terminado", "recepcionada"] as const satisfies readonly OtStatus[]

export const OT_STATUS_LABELS: Record<OtStatus, string> = {
  solicitada: "Por asignar",
  asignada: "Asignada",
  en_ejecucion: "En taller",
  trabajo_terminado: "Por recibir",
  recepcionada: "Por conformidad",
  cerrada: "Cerrada",
  anulada: "Anulada",
}

export type OtStatusTone = "default" | "warning" | "success" | "danger" | "outline"
export const OT_STATUS_TONES: Record<OtStatus, OtStatusTone> = {
  solicitada: "outline",
  asignada: "default",
  en_ejecucion: "warning",
  trabajo_terminado: "warning",
  recepcionada: "default",
  cerrada: "success",
  anulada: "danger",
}

export const OT_ITEM_KINDS = ["anexo", "mantencion"] as const
export type OtItemKind = (typeof OT_ITEM_KINDS)[number]
export const OT_ITEM_KIND_LABELS: Record<OtItemKind, string> = {
  anexo: "Trabajos anexos (reparación)",
  mantencion: "Mantenciones solicitadas o asignadas en taller",
}
/** Máximo de ítems por lista, como el talonario. */
export const OT_ITEM_MAX_PER_KIND = 12

export const OT_ITEM_ORIGINS = ["solicitud", "taller"] as const
export type OtItemOrigin = (typeof OT_ITEM_ORIGINS)[number]
export type OtItemDone = "si" | "no"

export const OT_WORKSHOP_KINDS = ["interno", "externo"] as const
export type OtWorkshopKind = (typeof OT_WORKSHOP_KINDS)[number]

export const OT_EVENT_TYPES = [
  "created",
  "edited",
  "assigned",
  "unassigned",
  "taken",
  "started",
  "entry_updated",
  "estimate_changed",
  "item_added",
  "items_marked",
  "finished",
  "received",
  "rejected",
  "conformed",
  "voided",
  "reopened",
  "record_linked",
] as const
export type OtEventType = (typeof OT_EVENT_TYPES)[number]

export const OT_PERMISSIONS = {
  viewWorksite: "mant:ot:view_worksite",
  viewAll: "mant:ot:view_all",
  create: "mant:ot:create",
  manage: "mant:ot:manage",
  execute: "mant:ot:execute",
  receive: "mant:ot:receive",
  conform: "mant:ot:conform",
} as const
export type OtPermission = (typeof OT_PERMISSIONS)[keyof typeof OT_PERMISSIONS]

/**
 * Transiciones de estado. `actor` dice quién puede ejecutarla, además del
 * permiso:
 * - `any`: basta el permiso (y el alcance de faena que exija el servicio);
 * - `assignee_or_manage`: el mecánico asignado (con execute) o quien tenga manage;
 * - `creator_or_manage`: quien creó la OT mientras siga solicitada, o manage.
 */
export type OtTransition =
  | "assign"
  | "unassign"
  | "take"
  | "start"
  | "finish"
  | "receive"
  | "reject_receipt"
  | "reject_conformity"
  | "conform"
  | "void"
  | "reopen"

export interface OtTransitionRule {
  from: readonly OtStatus[]
  to: OtStatus | "same"
  permission: OtPermission
  actor: "any" | "assignee_or_manage" | "creator_or_manage"
  /** Exige un motivo de al menos `REASON_MIN_LENGTH` caracteres. */
  requiresReason: boolean
}

export const OT_TRANSITIONS: Record<OtTransition, OtTransitionRule> = {
  // Reasignar dentro de en_ejecucion conserva el estado.
  assign:            { from: ["solicitada", "asignada", "en_ejecucion"], to: "same", permission: OT_PERMISSIONS.manage, actor: "any", requiresReason: false },
  unassign:          { from: ["asignada"], to: "solicitada", permission: OT_PERMISSIONS.manage, actor: "any", requiresReason: false },
  take:              { from: ["solicitada"], to: "asignada", permission: OT_PERMISSIONS.execute, actor: "any", requiresReason: false },
  start:             { from: ["asignada"], to: "en_ejecucion", permission: OT_PERMISSIONS.execute, actor: "assignee_or_manage", requiresReason: false },
  finish:            { from: ["en_ejecucion"], to: "trabajo_terminado", permission: OT_PERMISSIONS.execute, actor: "assignee_or_manage", requiresReason: false },
  receive:           { from: ["trabajo_terminado"], to: "recepcionada", permission: OT_PERMISSIONS.receive, actor: "any", requiresReason: false },
  reject_receipt:    { from: ["trabajo_terminado"], to: "en_ejecucion", permission: OT_PERMISSIONS.receive, actor: "any", requiresReason: true },
  reject_conformity: { from: ["recepcionada"], to: "en_ejecucion", permission: OT_PERMISSIONS.conform, actor: "any", requiresReason: true },
  conform:           { from: ["recepcionada"], to: "cerrada", permission: OT_PERMISSIONS.conform, actor: "any", requiresReason: false },
  void:              { from: ["solicitada", "asignada", "en_ejecucion"], to: "anulada", permission: OT_PERMISSIONS.manage, actor: "creator_or_manage", requiresReason: true },
  reopen:            { from: ["cerrada"], to: "en_ejecucion", permission: OT_PERMISSIONS.manage, actor: "any", requiresReason: true },
}

/** Estados en que el mecánico puede editar el ingreso, la fecha estimada y los ítems. */
export const OT_EXECUTION_EDITABLE: readonly OtStatus[] = ["en_ejecucion"]
/** Estados en que la solicitud (cabecera e ítems pedidos) aún se puede editar. */
export const OT_REQUEST_EDITABLE: readonly OtStatus[] = ["solicitada", "asignada"]

export function isOtStatus(value: string): value is OtStatus {
  return (OT_STATUSES as readonly string[]).includes(value)
}

export function canTransitionFrom(transition: OtTransition, status: OtStatus): boolean {
  return OT_TRANSITIONS[transition].from.includes(status)
}

export function targetStatus(transition: OtTransition, current: OtStatus): OtStatus {
  const to = OT_TRANSITIONS[transition].to
  if (to === "same") return current === "solicitada" ? "asignada" : current
  return to
}

/** `OT-BIO-0001`. */
export function formatWorkOrderFolio(worksiteFolioCode: string, sequence: number): string {
  return `OT-${worksiteFolioCode}-${String(sequence).padStart(4, "0")}`
}

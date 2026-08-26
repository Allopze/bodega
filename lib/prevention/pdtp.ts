/**
 * Vocabulario único del PDTP (TASK-UI-012).
 *
 * El estado de un programa y el de una ejecución se pintaban con tres mapas
 * distintos —controles de ciclo de vida, tabla de hojas y un ternario en el
 * listado de programas— y en tres pantallas se imprimía el enum crudo
 * (`active`, `submitted`). Eso produce sinónimos ("Cerrado"/"Completado") y
 * jerga de implementación visible. Un único mapa por familia evita ambas cosas.
 */

export type PdtpProgramStatus = "draft" | "in_review" | "rejected" | "active" | "closed" | "archived"

export const PDTP_PROGRAM_STATUS_LABELS: Record<PdtpProgramStatus, string> = {
  draft: "Borrador",
  in_review: "En revisión",
  rejected: "Rechazado",
  active: "Activo",
  closed: "Cerrado",
  archived: "Archivado",
}

/** Un estado desconocido se muestra tal cual: preferimos un dato raro visible a uno silenciado. */
export function pdtpProgramStatusLabel(status: string): string {
  return PDTP_PROGRAM_STATUS_LABELS[status as PdtpProgramStatus] ?? status
}

export type PdtpExecutionStatus = "draft" | "submitted" | "approved" | "rejected"

export const PDTP_EXECUTION_STATUS_LABELS: Record<PdtpExecutionStatus, string> = {
  draft: "Borrador",
  submitted: "Enviada",
  approved: "Aprobada",
  rejected: "Rechazada",
}

export function pdtpExecutionStatusLabel(status: string): string {
  return PDTP_EXECUTION_STATUS_LABELS[status as PdtpExecutionStatus] ?? status
}

export type PdtpActionStatus = "pendiente" | "en_proceso" | "completado" | "verificado" | "reabierto"

export const PDTP_ACTION_STATUS_LABELS: Record<PdtpActionStatus, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  completado: "Completado",
  verificado: "Verificado",
  reabierto: "Reabierto",
}

/** Variant de presentación para acciones/planes de acción. Vencida gana siempre. */
export function pdtpActionStatusVariant(estado: string, vencida: boolean): "default" | "info" | "warning" | "success" | "danger" {
  if (vencida) return "danger"
  switch (estado) {
    case "verificado": return "success"
    case "completado": return "info"
    case "en_proceso": return "warning"
    case "reabierto":  return "danger"
    default:           return "default"
  }
}

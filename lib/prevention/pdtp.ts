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

/**
 * Tipos de desvío por celda (`pdtp_execution_deviations.kind`). Vive acá, no
 * en `lib/services/pdtp/deviations.ts`, porque las etiquetas las consume la
 * UI cliente y ese módulo importa `@/db` — arrastrarlo al bundle del
 * navegador por tres strings no corresponde.
 */
export type PdtpDeviationKindValue = "not_performed" | "not_applicable" | "reprogrammed"

export const PDTP_DEVIATION_KIND_LABELS: Record<PdtpDeviationKindValue, string> = {
  not_performed: "No realizada",
  not_applicable: "No aplica",
  reprogrammed: "Reprogramada",
}

/** Descripción corta de lo que cada tipo hace con lo planificado. */
export const PDTP_DEVIATION_KIND_HINTS: Record<PdtpDeviationKindValue, string> = {
  not_performed: "La semana se sigue exigiendo y queda registrado por qué no se hizo.",
  not_applicable: "La semana deja de exigirse: sale del cálculo de cumplimiento.",
  reprogrammed: "Lo planificado se traslada a otra semana del mismo año.",
}

export function pdtpDeviationKindLabel(kind: string): string {
  return PDTP_DEVIATION_KIND_LABELS[kind as PdtpDeviationKindValue] ?? kind
}

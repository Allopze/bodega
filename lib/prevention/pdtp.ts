import type { Priority } from "@/components/ui/priority-badge"

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

/**
 * Variant de presentación para el estado del programa. Vivía duplicado como un
 * `STATUS_VARIANT` local en `program-lifecycle-controls.tsx` y, por separado,
 * como un ternario de 3 casillas en el listado de programas — el mismo
 * programa se veía "Borrador" (sans, minúscula) en la lista y "BORRADOR"
 * (mono, mayúscula) en el detalle, porque sólo el detalle pasaba por
 * `MetaBadge`. Un único mapa evita ambas cosas.
 */
export function pdtpProgramStatusVariant(status: string): "default" | "warning" | "danger" | "success" | "outline" {
  switch (status as PdtpProgramStatus) {
    case "draft": return "default"
    case "in_review": return "warning"
    case "rejected": return "danger"
    case "active": return "success"
    case "closed": return "outline"
    case "archived": return "outline"
    default: return "outline"
  }
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

/**
 * Cuándo debe realizarse una actividad (`pdtp_activities.schedule_mode`).
 * Se imprimía crudo (`scheduled`) en la tabla de Aplicabilidad; el copy en
 * español ya existía suelto en el constructor de actividades y en la pestaña
 * de planificación, sin un mapa compartido entre ambos.
 */
export type PdtpScheduleMode = "scheduled" | "on_demand" | "triggered"

export const PDTP_SCHEDULE_MODE_LABELS: Record<PdtpScheduleMode, string> = {
  scheduled: "Con frecuencia",
  on_demand: "A demanda",
  triggered: "Por evento",
}

export function pdtpScheduleModeLabel(mode: string): string {
  return PDTP_SCHEDULE_MODE_LABELS[mode as PdtpScheduleMode] ?? mode
}

/**
 * Cómo se mide el cumplimiento de una actividad
 * (`pdtp_activities.indicator_mode`). Se imprimía crudo
 * (`planned_vs_completed`) en la tabla de Aplicabilidad; no existía copy en
 * español para estos 5 valores en ningún otro lugar del código.
 */
export type PdtpIndicatorMode = "planned_vs_completed" | "closed_on_time" | "completed_count" | "not_applicable" | "coverage"

export const PDTP_INDICATOR_MODE_LABELS: Record<PdtpIndicatorMode, string> = {
  planned_vs_completed: "Planificado vs. ejecutado",
  closed_on_time: "Cerrado a tiempo",
  completed_count: "Cantidad ejecutada",
  not_applicable: "No aplica",
  coverage: "Cobertura",
}

export function pdtpIndicatorModeLabel(mode: string): string {
  return PDTP_INDICATOR_MODE_LABELS[mode as PdtpIndicatorMode] ?? mode
}

/**
 * Prioridad de una medida/acción correctiva (`alta`/`media`/`baja`, en
 * español). Se imprimía cruda en un `MetaBadge` con `variant: "outline"` fijo
 * — siempre gris, sin importar el valor. `PriorityBadge` existe para evitar
 * exactamente esta clase de bug, pero sus claves (`critical|high|normal|low`)
 * y sus etiquetas por defecto ("Normal") no coinciden con las palabras que ya
 * usa el selector de filtro de la misma pantalla ("Alta"/"Media"/"Baja") — de
 * ahí el `label` explícito en vez de dejar que `PriorityBadge` elija el suyo.
 */
export type PdtpActionPriority = "alta" | "media" | "baja"

const PDTP_PRIORITY_PRESENTATION: Record<PdtpActionPriority, { priority: Priority; label: string }> = {
  alta: { priority: "high", label: "Alta" },
  media: { priority: "normal", label: "Media" },
  baja: { priority: "low", label: "Baja" },
}

/** Una prioridad desconocida cae a "media": mismo default que ya usa el servicio al derivarla. */
export function pdtpPriorityPresentation(prioridad: string | undefined): { priority: Priority; label: string } {
  return PDTP_PRIORITY_PRESENTATION[prioridad as PdtpActionPriority] ?? PDTP_PRIORITY_PRESENTATION.media
}

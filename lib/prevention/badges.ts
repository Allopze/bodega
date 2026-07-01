/**
 * lib/prevention/badges.ts
 * Labels y variantes de badge para los estados usados en las listas de
 * prevención. Centraliza lo que antes cada lista definía localmente
 * (incident-list, iper-list, inspection-list/detail), siguiendo el mismo
 * patrón que @/lib/ppa/badges.
 */

type BadgeVariant = "default" | "primary" | "success" | "warning" | "signal" | "info" | "danger" | "outline"

/* ── Incidentes ──────────────────────────────────────────────────────────── */
export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  accidente: "Accidente",
  incidente: "Incidente",
  cuasi_accidente: "Cuasi accidente",
  enfermedad_profesional: "Enf. profesional",
}

export const INCIDENT_SEVERITY_VARIANTS: Record<string, BadgeVariant> = {
  leve: "default",
  moderado: "warning",
  grave: "danger",
  fatal: "danger",
}

export const INCIDENT_STATUS_LABELS: Record<string, string> = {
  open: "Abierto",
  investigating: "En investigación",
  closed: "Cerrado",
}

export function incidentStatusVariant(status: string): BadgeVariant {
  return status === "closed" ? "success" : "default"
}

/* ── IPER ────────────────────────────────────────────────────────────────── */
export const IPER_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  active: "Vigente",
  closed: "Cerrada",
}

export const IPER_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  draft: "default",
  active: "warning",
  closed: "success",
}

/* ── Inspecciones ────────────────────────────────────────────────────────── */
export const INSPECTION_RUN_STATUS_LABELS: Record<string, string> = {
  open: "Abierta",
  in_review: "En revisión",
  closed: "Cerrada",
}

export function inspectionRunStatusVariant(status: string): BadgeVariant {
  if (status === "open") return "primary"
  if (status === "closed") return "outline"
  return "warning"
}

export const INSPECTION_ITEM_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  ok: "OK",
  no_conforme: "No conforme",
  critico: "Crítico",
  na: "N/A",
}

export function inspectionItemStatusVariant(status: string): BadgeVariant {
  if (status === "critico") return "danger"
  if (status === "no_conforme") return "warning"
  if (status === "pendiente") return "outline"
  return "success"
}

export const BEHAVIORAL_SEVERITY_LABELS: Record<string, string> = {
  bajo: "Bajo",
  medio: "Medio",
  alto: "Alto",
  critico: "Crítico",
}

export function behavioralSeverityVariant(severity: string): BadgeVariant {
  return severity === "critico" ? "danger" : "outline"
}

/* ── Permisos de trabajo ─────────────────────────────────────────────────── */
export const PERMIT_STATUS_LABELS: Record<string, string> = {
  solicitado: "Solicitado",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  cerrado: "Cerrado",
}

export const PERMIT_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  solicitado: "warning",
  aprobado: "success",
  rechazado: "danger",
  cerrado: "outline",
}

/* ── Comités ─────────────────────────────────────────────────────────────── */
export const COMMITTEE_STATUS_LABELS: Record<string, string> = {
  activo: "Activo",
  inactivo: "Inactivo",
  disuelto: "Disuelto",
}

export const COMMITTEE_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  activo: "success",
  inactivo: "outline",
  disuelto: "danger",
}

export const AGREEMENT_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  cumplido: "Cumplido",
  vencido: "Vencido",
}

export const AGREEMENT_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  pendiente: "warning",
  en_curso: "primary",
  cumplido: "success",
  vencido: "danger",
}

/* ── Capacitaciones ──────────────────────────────────────────────────────── */
export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  completado: "Completado",
  vencido: "Vencido",
  exento: "Exento",
}

export const ASSIGNMENT_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  pendiente: "warning",
  completado: "success",
  vencido: "danger",
  exento: "outline",
}

/* ── Contratistas ────────────────────────────────────────────────────────── */
export const CONTRACTOR_STATUS_LABELS: Record<string, string> = {
  activo: "Activo",
  inactivo: "Inactivo",
  bloqueado: "Bloqueado",
}

export const CONTRACTOR_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  activo: "success",
  inactivo: "outline",
  bloqueado: "danger",
}

export const CONTRACTOR_DOCUMENT_TYPE_LABELS: Record<string, string> = {
  certificado_antecedentes: "Certificado de antecedentes",
  contrato_trabajo: "Contrato de trabajo",
  epp_entregado: "EPP entregado",
  capacitacion_ods: "Capacitación ODS",
  examen_preocupacional: "Examen preocupacional",
  reglamento_interno: "Reglamento interno",
  otro: "Otro",
}

export const CONTRACTOR_DOCUMENT_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  vigente: "Vigente",
  vencido: "Vencido",
}

export const CONTRACTOR_DOCUMENT_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  pendiente: "warning",
  vigente: "success",
  vencido: "danger",
}

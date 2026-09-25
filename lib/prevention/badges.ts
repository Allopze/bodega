/**
 * lib/prevention/badges.ts
 * Labels y variantes de badge para los estados usados en las listas de
 * prevención. Centraliza lo que antes cada lista definía localmente
 * (incident-list, iper-list, inspection-list/detail), siguiendo el mismo
 * patrón que @/lib/ppa/badges.
 */

import type { StateMetaInput } from "@/components/states/state-badge"

type BadgeVariant = StateMetaInput["variant"]

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

/* El vocabulario de estado de incidentes vive en `lib/prevention/incidents.ts`
 * (tipado contra `IncidentStatus`): aquí existía una copia antigua con otro
 * set de keys (`open`/`investigating`/`closed`) y sin consumidores. */

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
/* El vocabulario de estado de corridas de inspección vive en
 * `lib/prevention/inspections.ts` (`planned`/`in_progress`/…): aquí existía
 * una copia antigua (`open`/`in_review`/`closed`) sin consumidores. */

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
/* El vocabulario de estado de permisos vive en `lib/prevention/permits.ts`
 * (`draft`/`pending_approval`/…): aquí existía una copia antigua
 * (`solicitado`/`aprobado`/…) sin consumidores. */

/* ── Comités ─────────────────────────────────────────────────────────────── */
/* El vocabulario de estado de comités vive en `lib/prevention/cphs.ts`
 * (`active`/`dissolved`/`expired`): aquí existía una copia antigua
 * (`activo`/`inactivo`/`disuelto`) sin consumidores. */

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

/* ── Requisitos legales ──────────────────────────────────────────────────────
 * LEGAL-09: la ficha del requisito pintaba el enum crudo ("not_applicable") y
 * la mesa de trabajo tenía su propio diccionario incompleto, con una sola
 * entrada para dos vocabularios distintos: en aplicabilidad 'not_applicable'
 * es "No aplicable" (la faena no está alcanzada) y en cumplimiento es "No
 * aplica" (no hay nada que evaluar). Estos tres mapas cubren exactamente los
 * valores de las restricciones `prevention_legal_requirements_status_valid`,
 * `prevention_legal_applicabilities_status_valid` y
 * `..._compliance_valid`; `lib/__tests__/prevention-risk-legal.test.ts` lo
 * verifica contra el esquema para que un valor nuevo no llegue crudo a la UI. */
/** Estados de una versión MIPER (femenino: «la MIPER»). */
export const RISK_MATRIX_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  in_review: "En revisión",
  reviewed: "Revisada",
  approved: "Aprobada",
  published: "Vigente",
  superseded: "Reemplazada",
}

export const LEGAL_REQUIREMENT_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  in_review: "En revisión",
  reviewed: "Revisado",
  approved: "Aprobado",
  published: "Vigente",
  superseded: "Reemplazado",
}

export const LEGAL_APPLICABILITY_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  proposed_applicable: "Aplicable propuesto",
  proposed_not_applicable: "No aplicable propuesto",
  applicable: "Aplicable",
  not_applicable: "No aplicable",
}

export const LEGAL_COMPLIANCE_STATUS_LABELS: Record<string, string> = {
  not_assessed: "Sin evaluar",
  compliant: "Cumple",
  partial: "Cumplimiento parcial",
  noncompliant: "No cumple",
  not_applicable: "No aplica",
}

export function legalStatusVariant(status: string): BadgeVariant {
  if (["published", "approved", "applicable", "compliant"].includes(status)) return "success"
  if (status === "noncompliant") return "danger"
  // 'superseded' y 'not_applicable' no son un problema: son historia y alcance.
  if (["superseded", "not_applicable", "draft"].includes(status)) return "outline"
  return "warning"
}

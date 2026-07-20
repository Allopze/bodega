import type { CapaStatus } from "@/lib/services/prevention-capa"

export const CAPA_STATUS_LABELS: Record<CapaStatus, string> = {
  pending: "Pendiente",
  in_progress: "En proceso",
  pending_verification: "Pendiente de verificación",
  verified: "Verificada",
  closed: "Cerrada",
  reopened: "Reabierta",
  cancelled: "Cancelada",
}

export const CAPA_SOURCE_LABELS: Record<string, string> = {
  pdtp: "PDTP",
  sst_evaluation: "Evaluación SST",
  ppa: "PPA",
  incident: "Incidente",
  risk: "Riesgo MIPER",
  legal_requirement: "Requisito legal",
  training: "Brecha de competencia",
  work_permit: "Permiso de trabajo",
  inspection: "Inspección",
  cphs: "CPHS",
  emergency: "Simulacro de emergencia",
  change: "Gestión del cambio",
  manual: "Manual",
}

export function capaStatusLabel(status: string) {
  return CAPA_STATUS_LABELS[status as CapaStatus] ?? status
}

export function capaStatusBadgeVariant(status: string): "default" | "info" | "warning" | "success" | "danger" | "outline" {
  if (status === "closed" || status === "verified") return "success"
  if (status === "pending_verification") return "info"
  if (status === "in_progress" || status === "reopened") return "warning"
  if (status === "cancelled") return "outline"
  return "default"
}

export function capaSourceHref(sourceType: string, sourceId: string) {
  if (sourceType === "ppa") return `/prevencion/ppa/${sourceId}`
  if (sourceType === "sst_evaluation") return `/prevencion/${sourceId}`
  if (sourceType === "pdtp") return "/prevencion/pdtp"
  if (sourceType === "incident") return `/prevencion/incidentes/${sourceId}`
  if (sourceType === "risk") return `/prevencion/miper/${sourceId}`
  if (sourceType === "legal_requirement") return `/prevencion/requisitos-legales/${sourceId}`
  if (sourceType === "training") return `/prevencion/capacitacion/competencias?workerId=${encodeURIComponent(sourceId)}`
  if (sourceType === "work_permit") return `/prevencion/permisos/${sourceId}`
  if (sourceType === "inspection") return `/prevencion/inspecciones/${sourceId}`
  if (sourceType === "change") return `/prevencion/gestion-cambio/${sourceId}`
  return null
}

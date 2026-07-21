import type { IncidentStatus } from "@/lib/services/prevention-incidents"

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  reported: "Reportado",
  triage: "En triage",
  immediate_measures: "Medidas inmediatas",
  under_investigation: "En investigación",
  pending_capa: "Pendiente CAPA",
  pending_verification: "Pendiente verificación",
  closed: "Cerrado",
}

export const INCIDENT_EVENT_LABELS: Record<string, string> = {
  dangerous_incident: "Incidente o suceso peligroso",
  work_accident: "Accidente del trabajo",
  commute_accident: "Accidente de trayecto",
  suspected_occupational_disease: "Presunta enfermedad profesional",
  material_damage: "Daño material",
  environmental_spill: "Daño ambiental o derrame",
  vehicle_event: "Evento vehicular",
  contractor_or_third_party: "Contratista o tercero",
}

export const INCIDENT_SEVERITY_LABELS: Record<string, string> = {
  none: "Sin lesión",
  minor: "Menor",
  medical_treatment: "Tratamiento médico",
  lost_time: "Con tiempo perdido",
  serious: "Grave",
  fatal: "Fatal",
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
}

/** Client-safe metadata only. Parsing, encryption and persistence stay server-side. */

export function incidentStatusBadgeVariant(status: string): "default" | "info" | "warning" | "success" | "danger" {
  if (status === "closed") return "success"
  if (status === "reported" || status === "triage") return "danger"
  if (status === "pending_verification") return "info"
  return "warning"
}

export function notificationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Pendiente",
    sent: "Enviada",
    acknowledged: "Recepcionada",
    not_required: "No aplica",
    overdue: "Atrasada",
    authorized: "Autorizada",
  }
  return labels[status] ?? status
}

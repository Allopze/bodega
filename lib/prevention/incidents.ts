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
export const SFTI_INCIDENT_DICTIONARY = [
  { key: "externalId", label: "ID SFTI", required: true, aliases: ["id sfti", "id", "folio", "identificador"] },
  { key: "worksite", label: "Faena", required: true, aliases: ["faena", "codigo faena", "obra", "centro"] },
  { key: "eventType", label: "Tipo de evento", required: true, aliases: ["tipo de evento", "tipo evento", "clasificacion", "tipo"] },
  { key: "occurredAt", label: "Fecha/hora ocurrencia", required: true, aliases: ["fecha/hora ocurrencia", "fecha ocurrencia", "ocurrencia"] },
  { key: "knownAt", label: "Fecha/hora conocimiento", required: true, aliases: ["fecha/hora conocimiento", "fecha conocimiento", "conocimiento"] },
  { key: "companyName", label: "Empresa", required: true, aliases: ["empresa", "empleador", "razon social"] },
  { key: "location", label: "Lugar", required: true, aliases: ["lugar", "ubicacion", "sector"] },
  { key: "narrative", label: "Relato inicial", required: true, aliases: ["relato inicial", "relato", "descripcion"] },
  { key: "actualSeverity", label: "Gravedad real", required: false, aliases: ["gravedad real", "gravedad"] },
  { key: "potentialSeverity", label: "Gravedad potencial", required: false, aliases: ["gravedad potencial", "potencial"] },
  { key: "fatalOrSerious", label: "Fatal/grave", required: false, aliases: ["fatal/grave", "fatal grave", "grave"] },
  { key: "immediateMeasures", label: "Medidas inmediatas", required: false, aliases: ["medidas inmediatas", "medidas"] },
  { key: "operationsSuspended", label: "Operación suspendida", required: false, aliases: ["operacion suspendida", "suspension"] },
  { key: "personName", label: "Nombre persona", required: false, aliases: ["nombre persona", "trabajador", "nombre trabajador"] },
  { key: "personIdentifier", label: "RUT/ID persona", required: false, aliases: ["rut/id persona", "rut", "identificacion"] },
  { key: "injury", label: "Lesión", required: false, aliases: ["lesion", "diagnostico"] },
  { key: "bodyPart", label: "Parte afectada", required: false, aliases: ["parte afectada", "parte cuerpo"] },
] as const

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

import { asc, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionCapaActions,
  preventionIncidentEvidence,
  preventionIncidentHistory,
  preventionIncidentInvestigations,
  preventionIncidentNotifications,
  preventionIncidentPeople,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import {
  INCIDENT_EVENT_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  notificationStatusLabel,
} from "@/lib/prevention/incidents"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export"
import { sanitizeCell as safeCell } from "@/lib/reports/export-module/excel-builder"
import {
  getPreventionIncidentDetail,
  listPreventionIncidents,
  type IncidentAccess,
  type IncidentStatus,
} from "@/lib/services/prevention-incidents"
import { todayInChile } from "@/lib/utils"

function sheet(worksheetName: string, headers: string[], rows: ReportCell[][]): ReportSheet {
  return { worksheetName, headers, rows }
}

export async function buildIncidentRegisterExport(access: IncidentAccess): Promise<ReportData> {
  if (!access.permissions.includes("prevention:incidents:export")) throw new Error("Registro de incidentes no encontrado o fuera de alcance.")
  const incidents = await listPreventionIncidents({ access, limit: 2000 })
  const ids = incidents.map((incident) => incident.id)
  const empty = ids.length === 0
  const [people, notifications, investigations, evidence, capa, history] = empty ? [[], [], [], [], [], []] : await Promise.all([
    db.select().from(preventionIncidentPeople).where(inArray(preventionIncidentPeople.incidentId, ids)).orderBy(asc(preventionIncidentPeople.createdAt)),
    db.select().from(preventionIncidentNotifications).where(inArray(preventionIncidentNotifications.incidentId, ids)).orderBy(asc(preventionIncidentNotifications.deadlineAt)),
    db.select().from(preventionIncidentInvestigations).where(inArray(preventionIncidentInvestigations.incidentId, ids)).orderBy(asc(preventionIncidentInvestigations.startedAt)),
    db.select().from(preventionIncidentEvidence).where(inArray(preventionIncidentEvidence.incidentId, ids)).orderBy(asc(preventionIncidentEvidence.createdAt)),
    db.select().from(preventionCapaActions).where(inArray(preventionCapaActions.sourceId, ids)).orderBy(asc(preventionCapaActions.createdAt)),
    db.select().from(preventionIncidentHistory).where(inArray(preventionIncidentHistory.incidentId, ids)).orderBy(asc(preventionIncidentHistory.createdAt)),
  ])
  const incidentMap = new Map(incidents.map((incident) => [incident.id, incident]))
  const sheets: ReportSheet[] = [
    sheet("Registro legal", ["Código", "Tipo", "Estado", "Faena", "Empresa", "Ocurrencia", "Conocimiento", "Lugar", "Gravedad real", "Gravedad potencial", "Fatal/grave", "Origen", "Versión"], incidents.map((incident) => [
      safeCell(incident.code), safeCell(INCIDENT_EVENT_LABELS[incident.eventType] ?? incident.eventType), safeCell(INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status), safeCell(incident.worksiteName), safeCell(incident.companyName), incident.occurredAt, incident.knownAt, safeCell(incident.location), safeCell(INCIDENT_SEVERITY_LABELS[incident.actualSeverity] ?? incident.actualSeverity), safeCell(INCIDENT_SEVERITY_LABELS[incident.potentialSeverity] ?? incident.potentialSeverity), incident.isFatalOrSerious ? "Sí" : "No", incident.source, incident.version,
    ])),
    sheet("Personas minimizadas", ["Incidente", "Referencia", "Empleador", "Relación", "Sexo", "Ausencia jornada", "Días ausencia", "Días cargo", "Calificación administrador", "Clasificación"], people.map((person) => [safeCell(incidentMap.get(person.incidentId)?.code), safeCell(person.displayLabel), safeCell(person.employerName), safeCell(person.relationshipType), safeCell(person.sex), person.absenceAtLeastNormalShift ? "Sí" : "No", person.absenceDays, person.chargeDays, safeCell(person.administratorQualification), "personal_minimizado"])),
    sheet("Denuncias y plazos", ["Incidente", "Tipo", "Estado", "Deadline", "Responsable ID", "Organismo", "Enviada", "Evidencia", "Checksum", "Escalada", "Reinicio autorizado"], notifications.map((lane) => [safeCell(incidentMap.get(lane.incidentId)?.code), lane.notificationType.toUpperCase(), safeCell(notificationStatusLabel(lane.status)), lane.deadlineAt, safeCell(lane.responsibleUserId), safeCell(lane.administratorName), lane.sentAt, safeCell(lane.evidenceReference), safeCell(lane.evidenceChecksumSha256), lane.escalatedAt, lane.restartAuthorizedAt])),
    sheet("Investigaciones", ["Incidente", "Estado", "Metodología", "Equipo", "Causas inmediatas", "Causas básicas", "Causas organizacionales", "Controles fallidos", "Conclusiones", "MIPER requerido", "MIPER actualizado", "Procedimiento requerido", "Procedimiento actualizado", "Capacitación requerida", "Capacitación completada", "Inicio", "Cierre"], investigations.map((item) => [safeCell(incidentMap.get(item.incidentId)?.code), item.status, safeCell(item.methodology), safeCell(item.team), safeCell(item.immediateCauses), safeCell(item.basicCauses), safeCell(item.organizationalCauses), safeCell(item.failedControls), safeCell(item.conclusions), item.miperUpdateRequired ? "Sí" : "No", item.miperUpdatedAt, item.procedureUpdateRequired ? "Sí" : "No", item.procedureUpdatedAt, item.trainingRequired ? "Sí" : "No", item.trainingCompletedAt, item.startedAt, item.completedAt])),
    sheet("Evidencia operacional", ["Incidente", "Tipo", "Referencia", "Descripción", "Checksum", "Captura", "Creación", "Clasificación"], evidence.filter((item) => !item.isSensitive).map((item) => [safeCell(incidentMap.get(item.incidentId)?.code), item.kind, safeCell(item.reference), safeCell(item.description), safeCell(item.checksumSha256), item.capturedAt, item.createdAt, "operacional"])),
    sheet("CAPA", ["Incidente", "Código CAPA", "Estado", "Hallazgo", "Acción", "Prioridad", "Responsable", "Plazo", "Eficacia", "Verificada", "Cerrada"], capa.filter((action) => action.sourceType === "incident" && incidentMap.has(action.sourceId)).map((action) => [safeCell(incidentMap.get(action.sourceId)?.code), action.code, action.status, safeCell(action.finding), safeCell(action.actionDescription), action.priority, safeCell(action.responsibleSnapshot ?? action.responsibleUserId), action.targetDate, action.effectivenessStatus, action.verifiedAt, action.closedAt])),
    sheet("Historial", ["Incidente", "Fecha", "Cambio", "Desde", "Hacia", "Actor ID", "Motivo", "Detalle"], history.map((item) => [safeCell(incidentMap.get(item.incidentId)?.code), item.createdAt, item.changeType, safeCell(item.fromStatus), safeCell(item.toStatus), item.actorUserId, safeCell(item.reason), safeCell(item.changeSet)])),
  ]
  await recordAudit({
    userId: access.ctx.userId,
    action: "export",
    entityType: "prevention_incident_register",
    entityId: "scope",
    newState: { incidentCount: incidents.length, includesSensitive: false, sheetCount: sheets.length },
    reason: "Exportación Excel del registro canónico dentro del alcance autorizado",
    ipAddress: access.ctx.ip,
  })
  return {
    filenameBase: `registro-incidentes-${todayInChile()}`,
    worksheetName: sheets[0]!.worksheetName,
    headers: sheets[0]!.headers,
    rows: sheets[0]!.rows,
    sheets,
    rowLimitApplied: incidents.length >= 2000,
  }
}

export async function buildIncidentCaseExport(args: {
  incidentId: string
  includeSensitive: boolean
  purpose?: string
  access: IncidentAccess
}): Promise<ReportData | null> {
  if (!args.access.permissions.includes("prevention:incidents:export")) throw new Error("Incidente no encontrado o fuera de alcance.")
  const bundle = await getPreventionIncidentDetail({
    incidentId: args.incidentId,
    access: args.access,
    includeSensitive: args.includeSensitive,
    purpose: args.purpose,
  })
  if (!bundle) return null
  const incident = bundle.incident
  const sheets: ReportSheet[] = [
    sheet("Expediente", ["Campo", "Valor", "Clasificación"], [
      ["Código", safeCell(incident.code), "operacional"],
      ["Tipo", safeCell(INCIDENT_EVENT_LABELS[incident.eventType] ?? incident.eventType), "operacional"],
      ["Estado", safeCell(INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status), "operacional"],
      ["Faena", safeCell(bundle.worksiteName), "operacional"],
      ["Empresa", safeCell(incident.companyName), "operacional"],
      ["Ocurrencia", incident.occurredAt, "operacional"],
      ["Conocimiento", incident.knownAt, "operacional"],
      ["Lugar", safeCell(incident.location), "operacional"],
      ["Relato", safeCell(incident.initialNarrative), "operacional"],
      ["Medidas inmediatas", safeCell(incident.immediateMeasures), "operacional"],
      ["Gravedad real", safeCell(INCIDENT_SEVERITY_LABELS[incident.actualSeverity] ?? incident.actualSeverity), "operacional"],
      ["Gravedad potencial", safeCell(INCIDENT_SEVERITY_LABELS[incident.potentialSeverity] ?? incident.potentialSeverity), "operacional"],
      ["Fatal/grave", incident.isFatalOrSerious ? "Sí" : "No", "operacional"],
      ["Fuente", incident.source, "trazabilidad"],
      ["Versión", incident.version, "trazabilidad"],
    ]),
    sheet("Personas minimizadas", ["Persona ID", "Referencia", "Trabajador ID", "Empleador", "Relación", "Sexo", "Ausencia jornada", "Días ausencia", "Días cargo", "Calificación", "Clasificación"], bundle.people.map((person) => [person.id, safeCell(person.displayLabel), safeCell(person.workerId), safeCell(person.employerName), person.relationshipType, safeCell(person.sex), person.absenceAtLeastNormalShift ? "Sí" : "No", person.absenceDays, person.chargeDays, safeCell(person.administratorQualification), "personal_minimizado"])),
    sheet("Denuncias y plazos", ["Tipo", "Estado", "Deadline", "Responsable", "Organismo", "Enviada", "Evidencia", "Checksum", "Observaciones", "Escalada", "Reinicio autorizado", "Fundamento reinicio"], bundle.notifications.map((lane) => [lane.notificationType.toUpperCase(), notificationStatusLabel(lane.status), lane.deadlineAt, safeCell(lane.responsibleUserId), safeCell(lane.administratorName), lane.sentAt, safeCell(lane.evidenceReference), safeCell(lane.evidenceChecksumSha256), safeCell(lane.observations), lane.escalatedAt, lane.restartAuthorizedAt, safeCell(lane.restartAuthorizationReason)])),
    sheet("Investigación", ["Estado", "Metodología", "Equipo", "Resumen evidencia", "Causas inmediatas", "Causas básicas", "Causas organizacionales", "Controles fallidos", "Conclusiones", "Inicio", "Completada"], bundle.investigation ? [[bundle.investigation.status, safeCell(bundle.investigation.methodology), safeCell(bundle.investigation.team), safeCell(bundle.investigation.evidenceSummary), safeCell(bundle.investigation.immediateCauses), safeCell(bundle.investigation.basicCauses), safeCell(bundle.investigation.organizationalCauses), safeCell(bundle.investigation.failedControls), safeCell(bundle.investigation.conclusions), bundle.investigation.startedAt, bundle.investigation.completedAt]] : []),
    sheet("Evidencia", ["ID", "Tipo", "Referencia", "Descripción", "Checksum", "Sensible", "Captura", "Creación"], bundle.evidence.map((item) => [item.id, item.kind, safeCell(item.reference), safeCell(item.description), safeCell(item.checksumSha256), item.isSensitive ? "Sí" : "No", item.capturedAt, item.createdAt])),
    sheet("CAPA", ["Código", "Estado", "Hallazgo", "Medida", "Causa raíz", "Acción", "Prioridad", "Plazo", "Eficacia", "Verificada", "Cerrada"], bundle.capa.map((action) => [action.code, action.status, safeCell(action.finding), safeCell(action.immediateMeasure), safeCell(action.rootCause), safeCell(action.actionDescription), action.priority, action.targetDate, action.effectivenessStatus, action.verifiedAt, action.closedAt])),
    sheet("Historial", ["Fecha", "Cambio", "Desde", "Hacia", "Actor", "Motivo", "Detalle"], bundle.history.map((item) => [item.createdAt, item.changeType, safeCell(item.fromStatus), safeCell(item.toStatus), item.actorUserId, safeCell(item.reason), safeCell(item.changeSet)])),
  ]
  if (args.includeSensitive) {
    sheets.push(sheet("Datos reservados", ["Persona ID", "Payload", "Clasificación", "Propósito"], bundle.sensitivePeople.map((entry) => [entry.personId, safeCell(entry.payload), "sensible_salud", safeCell(args.purpose)])))
  }
  await recordAudit({
    userId: args.access.ctx.userId,
    action: "export",
    entityType: "prevention_incident",
    entityId: incident.id,
    entityCode: incident.code,
    newState: { includesSensitive: args.includeSensitive, sheetCount: sheets.length },
    reason: args.includeSensitive ? `Expediente Excel reservado: ${args.purpose}` : "Expediente Excel operacional",
    ipAddress: args.access.ctx.ip,
  })
  return {
    filenameBase: `expediente-${incident.code}`,
    worksheetName: sheets[0]!.worksheetName,
    headers: sheets[0]!.headers,
    rows: sheets[0]!.rows,
    sheets,
  }
}

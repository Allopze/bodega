import { z } from "zod"

export type { ActionState } from "./masters"

const riskScore = z.coerce.number().int().min(1).max(5)

export const iperMatrixCreateSchema = z.object({
  worksiteId:    z.string().min(1, "Faena requerida"),
  code:          z.string().trim().min(1, "Codigo requerido").max(40),
  version:       z.coerce.number().int().positive("Version requerida"),
  title:         z.string().trim().min(1, "Titulo requerido").max(160),
  effectiveFrom: z.string().min(1, "Fecha de vigencia requerida"),
  effectiveTo:   z.string().optional().or(z.literal("")),
})

export const iperRiskItemSchema = z.object({
  matrixId:            z.string().min(1, "Matriz requerida"),
  process:             z.string().trim().min(1).max(120),
  task:                z.string().trim().min(1).max(160),
  hazard:              z.string().trim().min(1).max(200),
  consequence:         z.string().trim().min(1).max(200),
  initialProbability:  riskScore,
  initialSeverity:     riskScore,
  controls:            z.array(z.string().trim().min(1)).min(1, "Indica al menos un control"),
  residualProbability: riskScore,
  residualSeverity:    riskScore,
  responsible:         z.string().trim().min(1).max(160),
  requiresTraining:    z.boolean().optional(),
  requiresPpa:         z.boolean().optional(),
})

const incidentTypeEnum = z.enum([
  "accidente",
  "incidente",
  "cuasi_accidente",
  "enfermedad_profesional",
])

export const preventionIncidentCreateSchema = z.object({
  worksiteId:     z.string().min(1, "Faena requerida"),
  workerId:       z.string().optional().or(z.literal("")),
  type:           incidentTypeEnum,
  severity:       z.enum(["leve", "moderado", "grave", "fatal"]).default("leve"),
  occurredAt:     z.string().min(1, "Fecha del evento requerida"),
  title:          z.string().trim().min(1, "Titulo requerido").max(160),
  description:    z.string().trim().min(1).max(2000),
  immediateCause: z.string().max(1000).optional().or(z.literal("")),
  rootCause:      z.string().max(1000).optional().or(z.literal("")),
  location:       z.string().max(160).optional().or(z.literal("")),
})

export const preventionIncidentActionSchema = z.object({
  incidentId:  z.string().min(1, "Incidente requerido"),
  description: z.string().trim().min(1).max(1000),
  responsible: z.string().trim().min(1).max(160),
  dueDate:     z.string().min(1, "Plazo requerido"),
})

export const trainingCourseCreateSchema = z.object({
  code:             z.string().trim().min(1).max(40),
  name:             z.string().trim().min(1).max(160),
  validityMonths:   z.coerce.number().int().positive().optional(),
  requiredForCargo: z.array(z.string().min(1)).default([]),
})

export const trainingAssignSchema = z.object({
  courseId:    z.string().min(1, "Curso requerido"),
  workerId:    z.string().min(1, "Trabajador requerido"),
  worksiteId:  z.string().min(1, "Faena requerida"),
  completedAt: z.string().min(1, "Fecha de realizacion requerida"),
  expiresAt:   z.string().optional().or(z.literal("")),
  score:       z.coerce.number().int().min(0).max(100).optional(),
  evidenceUrl: z.string().optional().or(z.literal("")),
})

export const pdtpExecutionSchema = z.object({
  activityId:       z.string().min(1, "Actividad requerida"),
  worksiteId:       z.string().min(1, "Faena requerida"),
  year:             z.coerce.number().int().min(2000).max(2100),
  month:            z.coerce.number().int().min(1).max(12),
  week:             z.coerce.number().int().min(1).max(4),
  executedQuantity: z.coerce.number().min(0),
  evidenceText:     z.string().max(2000).optional().or(z.literal("")),
  evidenceUrl:      z.string().max(500).optional().or(z.literal("")),
  evidencePhotos:   z.array(z.string().max(500)).default([]),
})

export const pdtpExecutionApprovalSchema = z.object({
  executionId: z.string().min(1, "Ejecución requerida"),
})

export const pdtpScheduleCellSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  week: z.coerce.number().int().min(1).max(4),
  plannedQuantity: z.coerce.number().min(0),
})

export const pdtpActivityUpdateSchema = z.object({
  activityId: z.string().min(1, "Actividad requerida"),
  activity: z.string().trim().max(200).optional(),
  program: z.string().trim().max(200).optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
  responsibleSlugs: z.array(z.string().min(1)).optional(),
  responsibleDisplay: z.string().trim().max(160).optional(),
  scheduleOverrides: z.array(pdtpScheduleCellSchema).optional(),
})

export const pdtpActivityAddSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  objectiveOrder: z.coerce.number().int().min(1).max(8),
  objective: z.string().trim().min(1).max(200),
  activity: z.string().trim().min(1).max(200),
  program: z.string().trim().min(1).max(200),
  responsibleSlugs: z.array(z.string().min(1)).min(1, "Al menos un responsable"),
  responsibleDisplay: z.string().trim().min(1).max(160),
  notes: z.string().max(2000).optional().or(z.literal("")),
  sheetCodes: z.array(z.string().min(1)).min(1, "Al menos una hoja"),
  schedule: z.array(pdtpScheduleCellSchema).optional(),
})

/* ── Inspecciones y observaciones ───────────────────────────────────────── */
const inspectionStatusEnum = z.enum(["ok", "no_conforme", "critico", "na"])
const runStatusEnum = z.enum(["open", "in_review", "closed"])

export const inspectionTemplateCreateSchema = z.object({
  code:          z.string().trim().min(1).max(40),
  title:         z.string().trim().min(1).max(160),
  scope:         z.string().trim().min(1).max(100),
  items:         z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    expected: z.string().min(1),
  })).min(1),
  frequency:     z.enum(["diaria", "semanal", "quincenal", "mensual", "trimestral", "semestral", "anual", "evento"]),
  requiresPhoto: z.boolean().default(false),
})

export const inspectionRunCreateSchema = z.object({
  templateId: z.string().min(1),
  worksiteId: z.string().min(1),
})

export const inspectionItemUpdateSchema = z.object({
  itemId:   z.string().min(1),
  observed: z.string().max(1000).optional().or(z.literal("")),
  status:   inspectionStatusEnum,
  note:     z.string().max(2000).optional().or(z.literal("")),
  photoUrl: z.string().max(500).optional().or(z.literal("")),
})

export const inspectionRunCloseSchema = z.object({
  runId:     z.string().min(1),
  signature: z.string().min(1).optional(),
})

export const behavioralObservationCreateSchema = z.object({
  worksiteId:  z.string().min(1),
  workerId:    z.string().optional().or(z.literal("")),
  antecedent:  z.string().trim().min(1).max(500),
  behavior:    z.string().trim().min(1).max(500),
  consequence: z.string().trim().min(1).max(500),
  severity:    z.enum(["bajo", "medio", "alto", "critico"]),
  runId:       z.string().optional().or(z.literal("")),
})

/* ── Reportes operacionales ──────────────────────────────────────────────── */
export const equipmentDailyReportSchema = z.object({
  worksiteId:       z.string().min(1),
  equipmentId:      z.string().min(1),
  operatorWorkerId: z.string().min(1),
  shift:            z.string().min(1),
  status:           z.enum(["ok", "observado", "fuera_servicio"]).default("ok"),
  odometer:         z.coerce.number().int().positive().optional(),
  hourmeter:        z.coerce.number().int().positive().optional(),
  checklist:        z.record(z.string(), z.unknown()).default({}),
})

export const equipmentReportReviewSchema = z.object({
  reportId:         z.string().min(1),
  status:           z.enum(["aprobado", "observado", "requiere_cierre"]),
  findings:         z.record(z.string(), z.unknown()).default({}),
})

export const equipmentChecklistSchema = z.object({
  worksiteId:  z.string().min(1),
  kind:        z.enum(["contenedor", "camion", "equipo", "carro", "batea", "taller_respel"]),
  assetCode:   z.string().min(1),
  items:       z.record(z.string(), z.unknown()).default({}),
  status:      z.enum(["ok", "observado", "fuera_servicio"]).default("ok"),
  closeRequired: z.boolean().default(false),
})

/* ── Alcotest ────────────────────────────────────────────────────────────── */
export const alcoholTestSchema = z.object({
  worksiteId:    z.string().min(1),
  testedWorkerId: z.string().optional().or(z.literal("")),
  shift:         z.string().min(1),
  result:        z.enum(["negativo", "positivo", "rechazado", "no_concluyente"]),
  evidenceUrl:   z.string().max(500).optional().or(z.literal("")),
  sentAt:        z.string().optional().or(z.literal("")),
})

/* ── Matriz EPP ──────────────────────────────────────────────────────────── */
export const eppPositionEntrySchema = z.object({
  worksiteId:    z.string().min(1),
  position:      z.string().trim().min(1).max(120),
  eppProductId:  z.string().min(1),
  riskId:        z.string().optional().or(z.literal("")),
  requiredSince: z.string().min(1),
  notes:         z.string().max(500).optional().or(z.literal("")),
})

export const eppLifecyclePolicySchema = z.object({
  eppProductId:       z.string().min(1),
  lifespanDays:       z.coerce.number().int().positive(),
  maxReuses:          z.coerce.number().int().positive().optional(),
  inspectionChecklist: z.record(z.string(), z.unknown()).default({}),
})

export const eppStockThresholdSchema = z.object({
  worksiteId:    z.string().min(1),
  eppProductId:  z.string().min(1),
  minStock:      z.coerce.number().int().min(0),
  criticalStock: z.coerce.number().int().min(0),
})

export const eppDeliveryLogSchema = z.object({
  workerId:      z.string().min(1, "Trabajador requerido"),
  eppProductId:  z.string().min(1, "EPP requerido"),
  deliveredAt:   z.string().optional().or(z.literal("")),
  evidenceUrl:   z.string().max(500).min(1, "El acta de entrega es requerida"),
})

/* ── Salud ocupacional ───────────────────────────────────────────────────── */
export const healthExamCreateSchema = z.object({
  workerId:    z.string().min(1, "Trabajador requerido"),
  type:        z.string().trim().min(1).max(80),
  protocolId:  z.string().optional().or(z.literal("")),
  performedAt: z.string().min(1, "Fecha requerida"),
  result:      z.string().trim().min(1).max(60),
  expiresAt:   z.string().optional().or(z.literal("")),
  evidenceUrl: z.string().max(500).optional().or(z.literal("")),
})

export const healthAptitudeSchema = z.object({
  workerId:     z.string().min(1, "Trabajador requerido"),
  examId:       z.string().optional().or(z.literal("")),
  position:     z.string().trim().min(1).max(120),
  aptitude:     z.string().trim().min(1).max(60),
  restrictions: z.record(z.string(), z.unknown()).default({}),
  validUntil:   z.string().optional().or(z.literal("")),
})

export const healthRestrictionCreateSchema = z.object({
  workerId:      z.string().min(1, "Trabajador requerido"),
  kind:          z.string().trim().min(1).max(80),
  description:   z.string().trim().min(1).max(1000),
  effectiveFrom: z.string().min(1, "Fecha requerida"),
  effectiveTo:   z.string().optional().or(z.literal("")),
})

/* ── Emergencias ─────────────────────────────────────────────────────────── */
export const emergencyPlanCreateSchema = z.object({
  worksiteId: z.string().min(1, "Faena requerida"),
  threats:    z.record(z.string(), z.unknown()).default({}),
  roles:      z.record(z.string(), z.unknown()).default({}),
  routes:     z.record(z.string(), z.unknown()).default({}),
})

export const emergencyDrillScheduleSchema = z.object({
  planId:      z.string().min(1, "Plan requerido"),
  type:        z.string().trim().min(1).max(60),
  scheduledAt: z.string().min(1, "Fecha requerida"),
})

export const emergencyDrillExecutionSchema = z.object({
  attendees:     z.coerce.number().int().min(0).optional(),
  findings:      z.record(z.string(), z.unknown()).default({}),
  effectiveness: z.string().trim().max(60).optional().or(z.literal("")),
})

export const emergencyEquipmentCreateSchema = z.object({
  worksiteId:       z.string().min(1, "Faena requerida"),
  kind:             z.string().trim().min(1).max(60),
  code:             z.string().trim().min(1).max(60),
  location:         z.string().trim().min(1).max(160),
  nextInspectionAt: z.string().optional().or(z.literal("")),
})

export const equipmentInspectionCreateSchema = z.object({
  equipmentId: z.string().min(1, "Equipo requerido"),
  status:      z.string().trim().min(1).max(40),
  findings:    z.record(z.string(), z.unknown()).default({}),
})

/* ── Comités ─────────────────────────────────────────────────────────────── */
export const committeeCreateSchema = z.object({
  worksiteId: z.string().min(1, "Faena requerida"),
  type:       z.string().trim().min(1).max(40),
})

export const committeeMemberAddSchema = z.object({
  committeeId: z.string().min(1, "Comité requerido"),
  userId:      z.string().min(1, "Usuario requerido"),
  role:        z.string().trim().min(1).max(60),
  startDate:   z.string().min(1, "Fecha requerida"),
})

export const committeeMeetingScheduleSchema = z.object({
  committeeId:  z.string().min(1, "Comité requerido"),
  scheduledAt:  z.string().min(1, "Fecha requerida"),
  agenda:       z.string().trim().min(1).max(2000),
  attendeeIds:  z.array(z.string().min(1)).default([]),
})

export const committeeAgreementAddSchema = z.object({
  meetingId:     z.string().min(1, "Reunión requerida"),
  description:   z.string().trim().min(1).max(1000),
  responsibleId: z.string().min(1, "Responsable requerido"),
  dueDate:       z.string().min(1, "Plazo requerido"),
})

/* ── Contratistas ───────────────────────────────────────────────────────── */
export const contractorCreateSchema = z.object({
  rut:                 z.string().trim().min(1, "RUT requerido").max(20),
  name:                z.string().trim().min(1, "Razón social requerida").max(200),
  legalRepresentative:  z.string().trim().max(160).optional().or(z.literal("")),
  contact:             z.string().trim().max(160).optional().or(z.literal("")),
  status:              z.enum(["activo", "inactivo", "bloqueado"]).default("activo"),
})

export const contractorWorkerAddSchema = z.object({
  contractorId: z.string().min(1, "Contratista requerido"),
  workerId:     z.string().min(1, "Trabajador requerido"),
  position:     z.string().trim().min(1, "Cargo requerido").max(120),
  startDate:    z.string().min(1, "Fecha de inicio requerida"),
  endDate:      z.string().optional().or(z.literal("")),
})

export const contractorDocumentAddSchema = z.object({
  contractorId: z.string().min(1, "Contratista requerido"),
  type:         z.enum([
    "certificado_antecedentes",
    "contrato_trabajo",
    "epp_entregado",
    "capacitacion_ods",
    "examen_preocupacional",
    "reglamento_interno",
    "otro",
  ]),
  versionId: z.string().optional().or(z.literal("")),
  status:    z.enum(["pendiente", "vigente", "vencido"]).default("pendiente"),
  expiresAt: z.string().optional().or(z.literal("")),
})

/* ── KPIs / horas hombre ─────────────────────────────────────────────────── */
export const laborHoursSetSchema = z.object({
  worksiteId: z.string().min(1, "Faena requerida"),
  period:     z.string().regex(/^\d{4}-\d{2}$/, "Formato de periodo inválido (YYYY-MM)"),
  hours:      z.coerce.number().positive("Las horas hombre deben ser mayores a 0"),
})

/* ── Permisos de trabajo ─────────────────────────────────────────────────── */
export const permitTemplateCreateSchema = z.object({
  code:            z.string().trim().min(1).max(40),
  title:           z.string().trim().min(1).max(160),
  riskType:        z.enum(["altura", "confinado", "caliente", "excavacion", "izaje", "electrico", "otro"]),
  astFields:       z.record(z.string(), z.unknown()).default({}),
  validityHours:   z.coerce.number().int().positive().optional(),
  requiresSignoff: z.record(z.string(), z.unknown()).default({}),
})

export const permitRequestSchema = z.object({
  templateId:   z.string().min(1),
  worksiteId:   z.string().min(1),
  task:         z.string().trim().min(1).max(500),
  location:     z.string().trim().min(1).max(200),
  plannedStart: z.string().min(1),
  plannedEnd:   z.string().min(1),
  ast:          z.record(z.string(), z.unknown()).default({}),
})

export const permitSignoffSchema = z.object({
  permitId:  z.string().min(1),
  role:      z.string().trim().min(1).max(60),
  signature: z.string().trim().min(1).max(2000),
})

/* ── Documentación Preventiva — Biblioteca SST ────────────────────────────
 *
 * Validación de input para el módulo documental interno.
 * NO cubre contratistas (esa sección sigue su propio flujo).
 *
 * Las constantes de slugs y entity_types deben matchear exactamente los
 * CHECK constraints de db/schema/prevention.ts.
 */

export const SST_DOCUMENT_CATEGORY_SLUGS = [
  "gestion_preventiva",
  "legal_normativa",
  "capacitacion",
  "epp",
  "incidentes",
  "comite",
  "emergencias",
  "equipos_vehiculos",
  "fiscalizacion",
  "salud_ocupacional",
] as const

export const SST_DOCUMENT_STATUSES = [
  "borrador",
  "en_revision",
  "observado",
  "aprobado",
  "vigente",
  "vencido",
  "reemplazado",
  "archivado",
] as const

export const SST_DOCUMENT_VERSION_STATUSES = [
  "borrador",
  "en_revision",
  "observado",
  "aprobado",
  "vigente",
  "reemplazado",
  "archivado",
] as const

export const SST_DOCUMENT_CONFIDENTIALITIES = [
  "publico_interno",
  "restringido",
  "sensible",
] as const

export const SST_DOCUMENT_LINK_ENTITY_TYPES = [
  "worker",
  "worksite",
  "vehicle",
  "equipment",
  "incident",
  "training",
  "committee",
  "epp_delivery",
  "corrective_action",
  "emergency_plan",
] as const

export const sstDocumentCreateSchema = z.object({
  categorySlug:    z.enum(SST_DOCUMENT_CATEGORY_SLUGS),
  typeId:          z.string().optional().or(z.literal("")),
  internalCode:    z.string().trim().max(60).optional().or(z.literal("")),
  title:           z.string().trim().min(1, "Título requerido").max(200),
  description:     z.string().max(2000).optional().or(z.literal("")),
  worksiteId:      z.string().optional().or(z.literal("")),
  confidentiality: z.enum(SST_DOCUMENT_CONFIDENTIALITIES).default("publico_interno"),
  effectiveFrom:   z.string().optional().or(z.literal("")),
  expiresAt:       z.string().optional().or(z.literal("")),
  responsibleUserId: z.string().optional().or(z.literal("")),
  requiresAcknowledgment: z.boolean().optional(),
  tags:            z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  extraMetadata:   z.record(z.string(), z.unknown()).default({}),
})

export const sstDocumentUpdateSchema = z.object({
  id:              z.string().min(1),
  title:           z.string().trim().min(1).max(200).optional(),
  description:     z.string().max(2000).optional().or(z.literal("")),
  worksiteId:      z.string().optional().or(z.literal("")),
  confidentiality: z.enum(SST_DOCUMENT_CONFIDENTIALITIES).optional(),
  effectiveFrom:   z.string().optional().or(z.literal("")),
  expiresAt:       z.string().optional().or(z.literal("")),
  responsibleUserId: z.string().optional().or(z.literal("")),
  requiresAcknowledgment: z.boolean().optional(),
  internalCode:    z.string().trim().max(60).optional().or(z.literal("")),
  tags:            z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  extraMetadata:   z.record(z.string(), z.unknown()).optional(),
})

export const sstDocumentVersionCreateSchema = z.object({
  documentId:    z.string().min(1, "Documento requerido"),
  effectiveFrom: z.string().optional().or(z.literal("")),
  effectiveTo:   z.string().optional().or(z.literal("")),
  changelog:     z.string().max(2000).optional().or(z.literal("")),
  supersedesId:  z.string().optional().or(z.literal("")),
})

export const sstDocumentStatusChangeSchema = z.object({
  documentId: z.string().min(1, "Documento requerido"),
  toStatus:   z.enum(SST_DOCUMENT_STATUSES),
  comment:    z.string().max(2000).optional().or(z.literal("")),
})

export const sstDocumentVersionStatusChangeSchema = z.object({
  versionId: z.string().min(1, "Versión requerida"),
  toStatus:  z.enum(SST_DOCUMENT_VERSION_STATUSES),
  comment:   z.string().max(2000).optional().or(z.literal("")),
})

export const sstDocumentApproveSchema = z.object({
  documentId: z.string().min(1),
  versionId:  z.string().min(1).optional().or(z.literal("")),
  comment:    z.string().max(2000).optional().or(z.literal("")),
})

export const sstDocumentObserveSchema = z.object({
  documentId: z.string().min(1, "Documento requerido"),
  versionId:  z.string().optional().or(z.literal("")),
  comment:    z.string().trim().min(1, "El comentario es obligatorio al observar").max(2000),
})

export const sstDocumentArchiveSchema = z.object({
  documentId: z.string().min(1),
  comment:    z.string().max(2000).optional().or(z.literal("")),
})

export const sstDocumentLinkSchema = z.object({
  documentId: z.string().min(1, "Documento requerido"),
  entityType: z.enum(SST_DOCUMENT_LINK_ENTITY_TYPES),
  entityId:   z.string().min(1, "Entidad requerida"),
  notes:      z.string().max(500).optional().or(z.literal("")),
})

export const sstDocumentUnlinkSchema = z.object({
  linkId: z.string().min(1, "Link requerido"),
})

export const sstDocumentAckSchema = z.object({
  versionId: z.string().min(1, "Versión requerida"),
  signature: z.string().trim().min(2, "Firma o nombre requerido").max(120),
})

export const sstDocumentSearchSchema = z.object({
  q:            z.string().trim().max(160).optional().or(z.literal("")),
  categorySlug: z.enum(SST_DOCUMENT_CATEGORY_SLUGS).optional().or(z.literal("")),
  status:       z.enum(SST_DOCUMENT_STATUSES).optional().or(z.literal("")),
  confidentiality: z.enum(SST_DOCUMENT_CONFIDENTIALITIES).optional().or(z.literal("")),
  worksiteId:   z.string().optional().or(z.literal("")),
  responsibleUserId: z.string().optional().or(z.literal("")),
  entityType:   z.enum(SST_DOCUMENT_LINK_ENTITY_TYPES).optional().or(z.literal("")),
  entityId:     z.string().optional().or(z.literal("")),
  expiresBefore: z.string().optional().or(z.literal("")),
  expiresAfter:  z.string().optional().or(z.literal("")),
  page:          z.coerce.number().int().min(1).default(1),
  pageSize:      z.coerce.number().int().min(1).max(200).default(25),
})

export const sstDocumentCategoryUpsertSchema = z.object({
  slug:        z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/, "Slug debe ser snake_case"),
  name:        z.string().trim().min(1).max(120),
  description: z.string().max(500).optional().or(z.literal("")),
  sortOrder:   z.coerce.number().int().default(0),
  isActive:    z.boolean().default(true),
})

export const sstDocumentTypeUpsertSchema = z.object({
  id:            z.string().optional().or(z.literal("")),
  categorySlug:  z.enum(SST_DOCUMENT_CATEGORY_SLUGS),
  code:          z.string().trim().min(1).max(40),
  name:          z.string().trim().min(1).max(160),
  description:   z.string().max(500).optional().or(z.literal("")),
  defaultConfidentiality: z.enum(SST_DOCUMENT_CONFIDENTIALITIES).default("publico_interno"),
  defaultValidityMonths:  z.coerce.number().int().positive().max(600).optional(),
  requiresApproval:       z.boolean().default(true),
  requiresAcknowledgment: z.boolean().default(false),
  isActive:    z.boolean().default(true),
})

/* Tipos derivados */
export type SstDocumentSearchInput = z.infer<typeof sstDocumentSearchSchema>
export type SstDocumentCreateInput = z.infer<typeof sstDocumentCreateSchema>
export type SstDocumentUpdateInput = z.infer<typeof sstDocumentUpdateSchema>

import { and, asc, desc, eq, inArray, like, lte, not, sql } from "drizzle-orm"
import { automaticChargeDaysForSeverity } from "@/lib/prevention/charge-days"
import { totalAbsenceDays } from "@/lib/prevention/absence-allocation"
import { z } from "zod"
import { db } from "@/db"
import { resolveOwnWorkSigning } from "@/lib/services/prevention-signing"
import {
  preventionCapaActions,
  preventionIncidentEvidence,
  preventionIncidentHistory,
  preventionIncidentInvestigations,
  preventionIncidentNotifications,
  preventionIncidentAbsencePeriods,
  preventionIncidentPeople,
  preventionIncidentPersonSensitivePayloads,
  preventionIncidentPublicReports,
  preventionIncidents,
  preventionIncidentClassificationCatalog,
  preventionIncidentStatements,
  preventionIncidentRe20Workspaces,
  preventionIncidentRe20QualityReviews,
  preventionIncidentRe20Policy,
  preventionIncidentRe20Mutations,
  preventionIncidentDiffusion,
  preventionIncidentShiftDiffusions,
  preventionIncidentFollowups,
  preventionRiskReviewTriggers,
  users,
  workers,
  worksites,
} from "@/db/schema"
import {
  onIncidentClosed,
  onIncidentDiatIssued,
  onIncidentFollowupRecorded,
  onIncidentInvestigationCompleted,
  onIncidentMeasuresDiffused,
  onIncidentOnePageDiffused,
  onIncidentPreliminaryReported,
  onIncidentReported,
  onIncidentShiftDiffused,
  onIncidentStatementRecorded,
  reconcileIncidentObligationsAfterTriage,
} from "@/lib/services/pdtp-adapters/incident-accreditation-connector"
import {
  auditIncidentSensitiveAccess,
  hasPermission,
  requireAccess,
  scopeAllows,
  scopeCondition,
  type IncidentAccess,
  type IncidentClient,
} from "@/lib/services/prevention-incident-access"
import { recordModuleHistory } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import {
  decryptPreventionPayload,
  encryptPreventionPayload,
} from "@/lib/security/prevention-field-encryption"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notifications"
import { onSafetyIndicatorPeriodReopened } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { invalidateClosedIndicatorPeriodWithClient, type ReopenedPeriodRevocation } from "@/lib/services/prevention-indicadores"
import { createRiskReviewTriggerWithClient } from "@/lib/services/prevention-risk-legal"
import { addDaysToPlainDate, codeYear, todayInChile } from "@/lib/utils"
import { enqueueGeneratedDocumentTx } from "@/lib/services/generated-documents/enqueue"
import { PERSON_SEX_VALUES } from "@/lib/person-sex"
import {
  DEFAULT_RE20_SLA_POLICY,
  RE20_CLASSIFICATION_OPTIONS,
  RE20_QUALITY_CRITERIA,
  RE20_TASK_DEFINITIONS,
  deriveRe20RootCauses,
  re20ApplicableTaskIds,
  re20CausalGraphCompletenessIssues,
  re20TreeRequired,
  type Re20SlaPolicy,
} from "@/lib/prevention/incidents"
import {
  re20PublicDataSchema,
  re20SensitivePayloadSchema,
  type Re20Measure,
  type Re20PublicData,
} from "@/lib/services/prevention-incident-re20-schema"

const CHILE_YEAR_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric" })
const CHILE_MONTH_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", month: "numeric" })

export const INCIDENT_EVENT_TYPES = [
  "dangerous_incident",
  "work_accident",
  "commute_accident",
  "suspected_occupational_disease",
  "material_damage",
  "environmental_spill",
  "vehicle_event",
  "contractor_or_third_party",
] as const

export const INCIDENT_STATUSES = [
  "reported",
  "triage",
  "immediate_measures",
  "under_investigation",
  "pending_capa",
  "pending_verification",
  "closed",
] as const

export const INCIDENT_NOTIFICATION_TYPES = [
  "diat",
  "diep",
  "fatal_dt",
  "fatal_seremi",
  "restart_authorization",
] as const

export type IncidentEventType = typeof INCIDENT_EVENT_TYPES[number]
export type IncidentStatus = typeof INCIDENT_STATUSES[number]
export type IncidentNotificationType = typeof INCIDENT_NOTIFICATION_TYPES[number]
export type { IncidentAccess }

const sensitivePersonSchema = z.object({
  fullName: z.string().trim().min(2).max(300).optional(),
  nationalIdentifier: z.string().trim().min(3).max(80).optional(),
  injuryDescription: z.string().trim().min(2).max(3000).optional(),
  affectedBodyPart: z.string().trim().min(2).max(300).optional(),
  clinicalNotes: z.string().trim().min(2).max(3000).optional(),
}).refine((value) => Object.values(value).some(Boolean), "El payload sensible está vacío.")

const incidentPersonSchema = z.object({
  workerId: z.string().min(1).nullable().optional(),
  displayLabel: z.string().trim().min(2).max(120),
  employerName: z.string().trim().min(2).max(300),
  sex: z.enum(PERSON_SEX_VALUES).nullable().optional(),
  relationshipType: z.enum(["employee", "contractor", "subcontractor", "visitor", "third_party"]),
  absenceAtLeastNormalShift: z.boolean().default(false),
  absenceDays: z.number().int().min(0).max(10000).default(0),
  chargeDays: z.number().int().min(0).max(10000).default(0),
  administratorQualification: z.string().trim().max(500).nullable().optional(),
  sensitive: sensitivePersonSchema.nullable().optional(),
})

const reportIncidentSchema = z.object({
  clientSubmissionId: z.string().trim().min(8).max(200),
  worksiteId: z.string().min(1),
  companyName: z.string().trim().min(2).max(300),
  companyTaxId: z.string().trim().max(40).nullable().optional(),
  eventType: z.enum(INCIDENT_EVENT_TYPES),
  occurredAt: z.string().datetime({ offset: true }),
  knownAt: z.string().datetime({ offset: true }),
  location: z.string().trim().min(2).max(1000),
  initialNarrative: z.string().trim().min(10).max(10000),
  processName: z.string().trim().max(300).nullable().optional(),
  taskName: z.string().trim().max(500).nullable().optional(),
  shiftName: z.string().trim().max(120).nullable().optional(),
  vehicleReference: z.string().trim().max(300).nullable().optional(),
  equipmentReference: z.string().trim().max(300).nullable().optional(),
  wasteReference: z.string().trim().max(300).nullable().optional(),
  substanceReference: z.string().trim().max(300).nullable().optional(),
  actualSeverity: z.enum(["none", "minor", "medical_treatment", "lost_time", "serious", "fatal"]).default("none"),
  potentialSeverity: z.enum(["low", "medium", "high", "critical", "fatal"]).default("low"),
  immediateMeasures: z.string().trim().max(5000).nullable().optional(),
  operationsSuspended: z.boolean().default(false),
  evacuated: z.boolean().default(false),
  isFatalOrSerious: z.boolean().default(false),
  offlineSync: z.boolean().default(false),
  // Momento del encolado en el dispositivo. No se persiste en columna propia:
  // basta con dejarlo en el historial para poder distinguir "reportó tarde" de
  // "sincronizó tarde" cuando la banda DIAT/DIEP nace vencida. Acotado a no
  // futuro por la deriva de reloj del dispositivo.
  queuedAt: z.string().datetime({ offset: true })
    .refine((value) => Date.parse(value) <= Date.now() + 5 * 60_000, "Fecha de encolado en el futuro")
    .optional(),
  people: z.array(incidentPersonSchema).max(100).default([]),
}).superRefine((value, ctx) => {
  if (new Date(value.knownAt).getTime() < new Date(value.occurredAt).getTime()) {
    ctx.addIssue({ code: "custom", path: ["knownAt"], message: "La hora de conocimiento no puede ser anterior a la ocurrencia." })
  }
  const fatalOrSerious = value.isFatalOrSerious || value.actualSeverity === "serious" || value.actualSeverity === "fatal"
  if (fatalOrSerious && !value.operationsSuspended) {
    ctx.addIssue({ code: "custom", path: ["operationsSuspended"], message: "Un evento fatal/grave exige suspensión de la operación." })
  }
  if (fatalOrSerious && (value.immediateMeasures?.trim().length ?? 0) < 10) {
    ctx.addIssue({ code: "custom", path: ["immediateMeasures"], message: "Un evento fatal/grave exige medidas inmediatas documentadas." })
  }
})

const triageSchema = z.object({
  incidentId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  actualSeverity: z.enum(["none", "minor", "medical_treatment", "lost_time", "serious", "fatal"]),
  potentialSeverity: z.enum(["low", "medium", "high", "critical", "fatal"]),
  isFatalOrSerious: z.boolean(),
  operationsSuspended: z.boolean(),
  evacuated: z.boolean(),
  immediateMeasures: z.string().trim().min(3).max(5000),
  notificationResponsibleUserId: z.string().min(1).nullable().optional(),
  administratorName: z.string().trim().max(300).nullable().optional(),
  reason: z.string().trim().min(5).max(2000),
})

const investigationSchema = z.object({
  incidentId: z.string().min(1),
  expectedIncidentVersion: z.number().int().positive(),
  methodology: z.string().trim().min(3).max(300),
  team: z.array(z.object({ userId: z.string().min(1), role: z.string().trim().min(2).max(120) })).min(1).max(30),
  evidenceSummary: z.string().trim().max(5000).nullable().optional(),
  immediateCauses: z.array(z.string().trim().min(2).max(1000)).max(100).default([]),
  basicCauses: z.array(z.string().trim().min(2).max(1000)).max(100).default([]),
  organizationalCauses: z.array(z.string().trim().min(2).max(1000)).max(100).default([]),
  failedControls: z.array(z.string().trim().min(2).max(1000)).max(100).default([]),
  conclusions: z.string().trim().max(10000).nullable().optional(),
  interviews: z.array(z.record(z.string(), z.unknown())).max(200).nullable().optional(),
  miperUpdateRequired: z.boolean().default(false),
  miperUpdated: z.boolean().default(false),
  procedureUpdateRequired: z.boolean().default(false),
  procedureUpdated: z.boolean().default(false),
  trainingRequired: z.boolean().default(false),
  trainingCompleted: z.boolean().default(false),
  complete: z.boolean().default(false),
  reason: z.string().trim().min(5).max(2000),
})

const notificationSchema = z.object({
  incidentId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  notificationType: z.enum(["diat", "diep", "fatal_dt", "fatal_seremi"]),
  sentAt: z.string().datetime({ offset: true }),
  evidenceReference: z.string().trim().min(3).max(4000),
  evidenceChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  administratorName: z.string().trim().max(300).nullable().optional(),
  observations: z.string().trim().max(3000).nullable().optional(),
})

const indicatorClassificationSchema = z.object({
  incidentId: z.string().min(1),
  personId: z.string().min(1),
  expectedIncidentVersion: z.number().int().positive(),
  expectedPersonVersion: z.number().int().positive(),
  absenceAtLeastNormalShift: z.boolean(),
  absenceDays: z.number().int().min(0).max(10000),
  chargeDays: z.number().int().min(0).max(10000),
  administratorQualification: z.string().trim().min(2).max(500).nullable().optional(),
  inclusionStatus: z.enum(["pending", "included", "excluded"]),
  reason: z.string().trim().min(10).max(3000),
  /**
   * NORM-07: períodos efectivos de incapacidad. Si vienen, mandan sobre
   * `absenceDays` (se deriva de las fechas) y los días se atribuyen al mes en
   * que realmente hubo reposo. Si no vienen, la persona conserva la imputación
   * heredada al mes de ocurrencia.
   */
  absencePeriods: z.array(z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de inicio inválida"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de término inválida").nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })).max(50).optional(),
}).superRefine((value, ctx) => {
  for (const [index, period] of (value.absencePeriods ?? []).entries()) {
    if (period.endDate && period.endDate < period.startDate) {
      ctx.addIssue({ code: "custom", path: ["absencePeriods", index, "endDate"], message: "El término del reposo no puede ser anterior a su inicio." })
    }
  }
  // NORM-01: una persona entra al indicador por ausencia con tiempo perdido O
  // por días de cargo. Un fallecido tiene `absenceDays = 0` y `chargeDays =
  // 6000`: exigir ausencia obligaba a dejar el fatal fuera de las tasas o a
  // inventarle días perdidos.
  if (value.inclusionStatus === "included" && !value.absenceAtLeastNormalShift && value.chargeDays < 1) {
    ctx.addIssue({
      code: "custom",
      path: ["absenceAtLeastNormalShift"],
      message: "Una persona incluida debe tener ausencia igual o superior a una jornada normal, o días de cargo por incapacidad permanente o muerte.",
    })
  }
  if (value.absenceAtLeastNormalShift && value.absenceDays < 1) {
    ctx.addIssue({ code: "custom", path: ["absenceDays"], message: "Registra al menos un día de ausencia." })
  }
})

/**
 * RE-20: estas seis entradas viajaban como tipos de TypeScript, que no validan
 * nada en runtime. `followupDate` entraba sin comprobar formato y los textos
 * largos sin cota, directo al insert.
 */
/** Fecha con o sin hora; una fecha civil se guarda a mediodía UTC para no cambiar de día al mostrarla. */
const followupInstant = z.union([
  z.string().datetime({ offset: true }),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((date) => `${date}T12:00:00.000Z`),
])

const re20TextSchemas = {
  preliminary: z.object({
    incidentId: z.string().min(1),
    preliminaryReportText: z.string().trim().min(10).max(10000),
  }),
  statement: z.object({
    incidentId: z.string().min(1),
    kind: z.enum(["involved", "witness", "cphs"]),
    purpose: z.string().trim().min(3).max(300),
    deponentName: z.string().trim().min(3).max(200),
    deponentRole: z.string().trim().max(200).optional(),
    statementText: z.string().trim().min(10).max(10000),
  }),
  onePage: z.object({
    incidentId: z.string().min(1),
    // Si no vienen, se derivan del expediente (reconstrucción, causas raíz y medidas).
    onePageSummary: z.string().trim().min(10).max(5000).optional(),
    rootCauseText: z.string().trim().min(10).max(5000).optional(),
    actionPlanSummary: z.string().trim().min(10).max(5000).optional(),
    /** RE-20-06 D24: aprendizaje para otras faenas. */
    learning: z.string().trim().max(3000).optional(),
    evidenceRef: z.string().trim().max(4000).optional(),
  }),
  followup: z.object({
    incidentId: z.string().min(1),
    followupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de seguimiento inválida"),
    note: z.string().trim().min(5).max(5000),
    evidenceRef: z.string().trim().max(4000).optional(),
    /** RE-20-08 (accidente) o RE-20-09 (daño). */
    kind: z.enum(["accident", "damage"]).default("accident"),
    measureId: z.string().trim().min(1).max(80).optional(),
    rootCauseId: z.string().trim().max(80).optional(),
    controlType: z.string().trim().max(80).optional(),
    verifierUserId: z.string().trim().min(1).optional(),
    verifiedAt: followupInstant.optional(),
    residualRisk: z.string().trim().max(80).optional(),
    implementedAt: followupInstant.optional(),
    verified: z.boolean().default(false),
    effective: z.boolean().default(false),
    lostDays: z.number().int().min(0).max(10000).optional(),
    lossDescription: z.string().trim().max(2000).optional(),
  }),
  diffusion: z.object({
    incidentId: z.string().min(1),
    kind: z.enum(["shift", "corrective_measures"]),
    summary: z.string().trim().min(3).max(5000),
    evidenceRef: z.string().trim().max(4000).optional(),
  }),
  confirmDiffusion: z.object({ diffusionId: z.string().min(1) }),
} as const

const re20WorkspaceSaveSchema = z.object({
  incidentId: z.string().min(1),
  expectedVersion: z.number().int().min(0),
  mutationId: z.string().trim().min(8).max(200),
  data: re20PublicDataSchema,
  sensitive: re20SensitivePayloadSchema.optional(),
})

const re20QualityReviewSchema = z.object({
  incidentId: z.string().min(1),
  expectedWorkspaceVersion: z.number().int().positive(),
  decision: z.enum(["approved", "approved_with_observations", "changes_required"]),
  observation: z.string().trim().max(5000).nullable().optional(),
  criteria: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    result: z.enum(["meets", "partial", "does_not_meet"]),
    observation: z.string().trim().max(1000).optional(),
  })).length(RE20_QUALITY_CRITERIA.length),
})

const evidenceSchema = z.object({
  incidentId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  investigationId: z.string().min(1).nullable().optional(),
  kind: z.enum(["document", "photo", "video", "interview", "diagram", "external_reference", "note"]),
  reference: z.string().trim().min(3).max(4000),
  description: z.string().trim().max(2000).nullable().optional(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  isSensitive: z.boolean().default(false),
  capturedAt: z.string().datetime({ offset: true }).nullable().optional(),
})

const capaSchema = z.object({
  incidentId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  finding: z.string().trim().min(3).max(3000),
  immediateMeasure: z.string().trim().max(3000).nullable().optional(),
  rootCause: z.string().trim().max(3000).nullable().optional(),
  actionDescription: z.string().trim().min(3).max(3000),
  responsibleUserId: z.string().min(1).nullable().optional(),
  responsibleSnapshot: z.string().trim().max(300).nullable().optional(),
  responsibleRole: z.string().trim().max(120).nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  evidenceRequired: z.boolean().default(true),
  /** CAPA-002: si la CAPA del incidente no exigirá evidencia, hay que decir por qué. */
  evidenceExemptionReason: z.string().trim().max(1000).nullable().optional(),
  /** Elemento del expediente que originó la acción (p. ej. la medida RE-20). */
  sourceItemId: z.string().trim().min(1).max(120).nullable().optional(),
})

const transitionSchema = z.object({
  incidentId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  toStatus: z.enum(INCIDENT_STATUSES),
  reason: z.string().trim().min(5).max(2000),
})

/**
 * NORM-06: la faena sólo vuelve a operar con autorización del ORGANISMO
 * FISCALIZADOR (Ley 16.744 art. 76). La autorización interna de Prevención o
 * Gerencia no la reemplaza, así que estos datos son obligatorios: sin ellos no
 * se levanta la suspensión.
 *
 * El flujo normativo se cumple con los gates que ya existían más este bloque:
 *   SUSPENDED                     → `operationsSuspended = true` al reportar
 *   CORRECTIVE_ACTIONS_COMPLETED  → investigación completa + CAPA verificada
 *   RESTART_REQUESTED             → DT y SEREMI notificadas con evidencia
 *   AUTHORITY_AUTHORIZED          → los campos de autoridad de este schema
 *   OPERATIONS_RESUMED            → `operationsSuspended = false`
 */
const restartSchema = z.object({
  incidentId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(3000),
  /** Organismo que autorizó (DT, SEREMI de Salud, SERNAGEOMIN…). */
  authorityName: z.string().trim().min(3).max(300),
  /** Folio, número de resolución u oficio con que se levantó la suspensión. */
  authorizationReference: z.string().trim().min(3).max(300),
  /** Fecha de la autorización, no la del registro en el sistema. */
  authorizationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de autorización inválida"),
  /** Documento verificable de respaldo. */
  evidenceReference: z.string().trim().min(3).max(4000),
  evidenceChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  segregationExceptionReason: z.string().trim().min(10).max(2000).optional(),
}).superRefine((value, ctx) => {
  if (Date.parse(`${value.authorizationDate}T00:00:00Z`) > Date.now() + 86_400_000) {
    ctx.addIssue({ code: "custom", path: ["authorizationDate"], message: "La autorización no puede tener fecha futura." })
  }
})

const TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  // reported → triage no pasa por aquí: sólo `triagePreventionIncident` hace ese
  // paso, porque es el que exige gravedades, medidas y responsable y el que abre
  // (o libera) los carriles legales. La transición genérica lo saltaba entero.
  reported: [],
  triage: ["immediate_measures"],
  immediate_measures: ["under_investigation"],
  under_investigation: ["pending_capa"],
  pending_capa: ["pending_verification"],
  pending_verification: ["closed"],
  closed: [],
}

const TRANSITION_PERMISSION: Record<IncidentStatus, string> = {
  reported: "prevention:incidents:report",
  triage: "prevention:incidents:triage",
  immediate_measures: "prevention:incidents:triage",
  under_investigation: "prevention:incidents:investigate",
  pending_capa: "prevention:incidents:investigate",
  pending_verification: "prevention:incidents:investigate",
  closed: "prevention:incidents:close",
}

export function incidentNotificationDeadline(knownAt: string) {
  const known = new Date(knownAt)
  if (Number.isNaN(known.getTime())) throw new Error("Hora de conocimiento inválida.")
  return new Date(known.getTime() + 24 * 60 * 60 * 1000).toISOString()
}

/** Carriles que sólo existen porque el evento se calificó fatal/grave. */
const FATAL_OR_SERIOUS_LANES: IncidentNotificationType[] = ["fatal_dt", "fatal_seremi", "restart_authorization"]

export function requiredIncidentNotificationTypes(args: {
  eventType: IncidentEventType
  isFatalOrSerious: boolean
}): IncidentNotificationType[] {
  const result: IncidentNotificationType[] = []
  if (["work_accident", "commute_accident"].includes(args.eventType)) result.push("diat")
  if (args.eventType === "suspected_occupational_disease") result.push("diep")
  if (args.isFatalOrSerious) result.push(...FATAL_OR_SERIOUS_LANES)
  return result
}

export function incidentRequiresInvestigation(incident: {
  eventType: string
  actualSeverity: string
  potentialSeverity: string
  isFatalOrSerious: boolean
}) {
  return incident.isFatalOrSerious
    || incident.actualSeverity !== "none"
    || ["high", "critical", "fatal"].includes(incident.potentialSeverity)
    || ["dangerous_incident", "work_accident", "commute_accident", "suspected_occupational_disease", "environmental_spill", "vehicle_event", "contractor_or_third_party"].includes(incident.eventType)
}

export function incidentRequiresCapa(incident: {
  actualSeverity: string
  potentialSeverity: string
  isFatalOrSerious: boolean
}) {
  return incident.isFatalOrSerious
    || ["medical_treatment", "lost_time", "serious", "fatal"].includes(incident.actualSeverity)
    || ["high", "critical", "fatal"].includes(incident.potentialSeverity)
}

function createIncidentCode() {
  return `INC-${codeYear()}-${nanoid(10).toUpperCase()}`
}

function nowIso() {
  return new Date().toISOString()
}

async function appendHistory(client: IncidentClient, args: {
  incidentId: string
  changeType: typeof preventionIncidentHistory.$inferInsert["changeType"]
  actorUserId: string
  fromStatus?: string | null
  toStatus?: string | null
  reason?: string | null
  changeSet?: Record<string, unknown> | null
  createdAt?: string
}) {
  await client.insert(preventionIncidentHistory).values({
    id: `inch-${nanoid()}`,
    incidentId: args.incidentId,
    changeType: args.changeType,
    fromStatus: args.fromStatus ?? null,
    toStatus: args.toStatus ?? null,
    reason: args.reason ?? null,
    changeSet: args.changeSet ?? null,
    actorUserId: args.actorUserId,
    createdAt: args.createdAt ?? nowIso(),
  })
}

/**
 * Loader común de toda mutación del expediente. El cierre exigió investigación
 * completa, CAPA cerradas y notificaciones con evidencia; permitir escrituras
 * posteriores corrompería el expediente que sustentó ese cierre, y no existe
 * transición de reapertura que lo audite. Por eso el guard vive aquí y no en
 * cada llamador: ninguna mutación necesita legítimamente un incidente cerrado.
 */
async function findIncidentForMutation(client: IncidentClient, incidentId: string) {
  const [incident] = await client.select().from(preventionIncidents)
    .where(eq(preventionIncidents.id, incidentId)).limit(1)
  if (!incident) throw new Error("Incidente no encontrado o fuera de alcance.")
  if (incident.status === "closed") throw new Error("El incidente está cerrado y su expediente es inmutable.")
  return incident
}

async function assertWorkerScope(client: IncidentClient, workerId: string, worksiteId: string) {
  const [worker] = await client.select({ id: workers.id, sex: workers.sex }).from(workers)
    .where(and(eq(workers.id, workerId), eq(workers.worksiteId, worksiteId), eq(workers.isActive, true))).limit(1)
  if (!worker) throw new Error("La persona vinculada no pertenece a la faena o está inactiva.")
  return worker
}

async function createNotificationLanes(client: IncidentClient, args: {
  incidentId: string
  eventType: IncidentEventType
  isFatalOrSerious: boolean
  knownAt: string
  responsibleUserId?: string | null
  administratorName?: string | null
  now: string
}) {
  const types = requiredIncidentNotificationTypes(args)
  if (types.length === 0) return
  const legalDeadline = incidentNotificationDeadline(args.knownAt)
  await client.insert(preventionIncidentNotifications).values(types.map((type) => ({
    id: `incn-${nanoid()}`,
    incidentId: args.incidentId,
    notificationType: type,
    deadlineAt: type === "diat" || type === "diep" ? legalDeadline : (type === "restart_authorization" ? null : args.knownAt),
    status: "pending",
    administratorName: args.administratorName ?? null,
    responsibleUserId: args.responsibleUserId ?? null,
    createdAt: args.now,
    updatedAt: args.now,
  }))).onConflictDoNothing()
}

async function updateNotificationAssignment(client: IncidentClient, args: {
  incidentId: string
  responsibleUserId?: string | null
  administratorName?: string | null
  now: string
}) {
  await client.update(preventionIncidentNotifications).set({
    responsibleUserId: args.responsibleUserId ?? null,
    administratorName: args.administratorName ?? null,
    updatedAt: args.now,
  }).where(eq(preventionIncidentNotifications.incidentId, args.incidentId))
}

export async function reportPreventionIncident(args: {
  input: unknown
  access: IncidentAccess
  /**
   * El incidente nace de un reporte del canal del trabajador. Va fuera de
   * `input` a propósito: la acción del formulario de reporte sólo pasa `input`,
   * así que no puede vincular (ni cerrar) un reporte del buzón por su cuenta.
   */
  fromPublicReport?: { reportId: string; notes: string }
}) {
  // Abrir el incidente desde el buzón es parte del triage del reporte, no un
  // reporte nuevo: quien clasifica (`incidents:triage`) puede hacerlo aunque no
  // reporte (jefa_chome). El reporte original ya lo hizo el trabajador.
  const permission = args.fromPublicReport ? "prevention:incidents:triage" : "prevention:incidents:report"
  requireAccess(args.access, permission)
  const input = reportIncidentSchema.parse(args.input)
  requireAccess(args.access, permission, input.worksiteId)
  const fatalOrSerious = input.isFatalOrSerious || input.actualSeverity === "serious" || input.actualSeverity === "fatal"

  const result = await db.transaction(async (tx) => {
    // El sexo del padrón se copia al vincular: queda fijado en el incidente
    // como estaba el día del evento, y corregir después la ficha no mueve la
    // desagregación de indicadores ya informados. Lo que declare el reporte
    // prevalece sobre el padrón.
    const workerSexById = new Map<string, string | null>()
    for (const person of input.people) {
      if (!person.workerId) continue
      const worker = await assertWorkerScope(tx, person.workerId, input.worksiteId)
      workerSexById.set(worker.id, worker.sex)
    }

    const now = nowIso()
    const incidentId = `inc-${nanoid()}`
    const [created] = await tx.insert(preventionIncidents).values({
      id: incidentId,
      code: createIncidentCode(),
      clientSubmissionId: input.clientSubmissionId,
      worksiteId: input.worksiteId,
      companyName: input.companyName,
      companyTaxId: input.companyTaxId ?? null,
      eventType: input.eventType,
      status: "reported",
      occurredAt: input.occurredAt,
      knownAt: input.knownAt,
      location: input.location,
      initialNarrative: input.initialNarrative,
      reportedByUserId: args.access.ctx.userId,
      processName: input.processName ?? null,
      taskName: input.taskName ?? null,
      shiftName: input.shiftName ?? null,
      vehicleReference: input.vehicleReference ?? null,
      equipmentReference: input.equipmentReference ?? null,
      wasteReference: input.wasteReference ?? null,
      substanceReference: input.substanceReference ?? null,
      actualSeverity: input.actualSeverity,
      potentialSeverity: input.potentialSeverity,
      immediateMeasures: input.immediateMeasures ?? null,
      operationsSuspended: input.operationsSuspended,
      evacuated: input.evacuated,
      isFatalOrSerious: fatalOrSerious,
      source: input.offlineSync ? "offline_sync" : "platform",
      version: 1,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing({ target: preventionIncidents.clientSubmissionId }).returning()

    if (!created) {
      const [existing] = await tx.select().from(preventionIncidents)
        .where(eq(preventionIncidents.clientSubmissionId, input.clientSubmissionId)).limit(1)
      if (!existing || existing.reportedByUserId !== args.access.ctx.userId || existing.worksiteId !== input.worksiteId) {
        throw new Error("La clave de sincronización ya fue utilizada por otro reporte.")
      }
      return { incident: existing, idempotentReplay: true }
    }

    if (args.fromPublicReport) {
      // Misma transacción que el alta: o el reporte queda triado apuntando a
      // este incidente, o no se crea el incidente. Dos personas convirtiendo el
      // mismo reporte no abren dos expedientes.
      const [linked] = await tx.update(preventionIncidentPublicReports).set({
        status: "triaged",
        triagedByUserId: args.access.ctx.userId,
        triagedAt: now,
        triageNotes: args.fromPublicReport.notes,
        incidentId,
        updatedAt: now,
      }).where(and(
        eq(preventionIncidentPublicReports.id, args.fromPublicReport.reportId),
        eq(preventionIncidentPublicReports.status, "pending"),
        eq(preventionIncidentPublicReports.worksiteId, input.worksiteId),
      )).returning({ id: preventionIncidentPublicReports.id })
      if (!linked) throw new Error("El reporte ya fue triado o no existe.")
    }

    for (const personInput of input.people) {
      const personId = `incp-${nanoid()}`
      await tx.insert(preventionIncidentPeople).values({
        id: personId,
        incidentId,
        workerId: personInput.workerId ?? null,
        displayLabel: personInput.displayLabel,
        employerName: personInput.employerName,
        sex: personInput.sex ?? (personInput.workerId ? workerSexById.get(personInput.workerId) : null) ?? null,
        relationshipType: personInput.relationshipType,
        absenceAtLeastNormalShift: personInput.absenceAtLeastNormalShift,
        absenceDays: personInput.absenceDays,
        chargeDays: personInput.chargeDays,
        administratorQualification: personInput.administratorQualification ?? null,
        createdAt: now,
        updatedAt: now,
      })
      if (personInput.sensitive) {
        const encrypted = encryptPreventionPayload(personInput.sensitive, `incident-person:${personId}`)
        await tx.insert(preventionIncidentPersonSensitivePayloads).values({
          id: `incps-${nanoid()}`,
          personId,
          ...encrypted,
          createdByUserId: args.access.ctx.userId,
          updatedByUserId: args.access.ctx.userId,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    await createNotificationLanes(tx, {
      incidentId,
      eventType: input.eventType,
      isFatalOrSerious: fatalOrSerious,
      knownAt: input.knownAt,
      now,
    })
    await appendHistory(tx, {
      incidentId,
      changeType: "reported",
      actorUserId: args.access.ctx.userId,
      toStatus: "reported",
      reason: input.offlineSync ? "Sincronización de reporte offline" : "Reporte inicial",
      changeSet: {
        eventType: input.eventType,
        worksiteId: input.worksiteId,
        source: input.offlineSync ? "offline_sync" : "platform",
        peopleCount: input.people.length,
        fatalOrSerious,
        // Sin esto, un reporte encolado en terreno y sincronizado días después
        // era indistinguible de un incumplimiento real del plazo de 24 h.
        ...(input.queuedAt ? { queuedAt: input.queuedAt } : {}),
      },
      createdAt: now,
    })

    return { incident: created, idempotentReplay: false }
  })

  // Auto-acreditación PDTP: Actividades 66, 67 siempre; 68-75,77,78 filtradas
  // por tipo de evento/severidad (fuera de la transacción).
  await onIncidentReported({
    incidentId: result.incident.id,
    worksiteId: result.incident.worksiteId,
    reportedAt: result.incident.createdAt,
    userId: args.access.ctx.userId,
    eventType: result.incident.eventType as IncidentEventType,
    actualSeverity: result.incident.actualSeverity,
    potentialSeverity: result.incident.potentialSeverity,
    isFatalOrSerious: result.incident.isFatalOrSerious,
  })

  return result
}

/**
 * Clasificación explícita para el motor DS 44. Nunca infiere inclusión oficial
 * desde el texto libre de la resolución del organismo administrador.
 */
export async function classifyIncidentPersonForIndicators(args: {
  input: unknown
  access: IncidentAccess
}) {
  requireAccess(args.access, "prevention:incidents:investigate")
  const input = indicatorClassificationSchema.parse(args.input)
  // Reclasificar a una persona puede reabrir el período de indicadores ya
  // cerrado de ese mes, y eso deja sin efecto la acreditación de la N°7. La
  // revocación se prepara acá y se dispara después del commit: el conector abre
  // su propia conexión.
  let revocation: ReopenedPeriodRevocation | null = null
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({
      person: preventionIncidentPeople,
      incident: preventionIncidents,
    }).from(preventionIncidentPeople)
      .innerJoin(preventionIncidents, eq(preventionIncidents.id, preventionIncidentPeople.incidentId))
      .where(and(
        eq(preventionIncidentPeople.id, input.personId),
        eq(preventionIncidents.id, input.incidentId),
      )).limit(1)
    if (!current) throw new Error("Persona del incidente no encontrada o fuera de alcance.")
    requireAccess(args.access, "prevention:incidents:investigate", current.incident.worksiteId)
    // No pasa por `findIncidentForMutation` porque carga la persona junto al
    // incidente, así que la regla del expediente cerrado se repite aquí: una
    // reclasificación posterior cambiaría las tasas que sustentó el cierre.
    if (current.incident.status === "closed") throw new Error("El incidente está cerrado y su expediente es inmutable.")
    if (current.incident.version !== input.expectedIncidentVersion || current.person.version !== input.expectedPersonVersion) {
      throw new Error("El incidente o la clasificación cambiaron; recarga antes de guardar.")
    }
    if (input.inclusionStatus === "included" && current.incident.eventType !== "work_accident") {
      throw new Error("Sólo un accidente del trabajo puede incluirse en estas tasas; registra una exclusión fundamentada para trayecto, enfermedad u otro evento.")
    }
    // Los días de cargo por muerte los fija la tabla normativa, no el usuario:
    // es una cifra reglamentaria, no un juicio de quien clasifica. Se aplica
    // siempre que la severidad del incidente sea fatal, incluso si el
    // formulario mandó otra cosa.
    const automaticCharge = automaticChargeDaysForSeverity(current.incident.actualSeverity)
    const chargeDays = automaticCharge ?? input.chargeDays

    // NORM-07: con fechas reales, `absenceDays` se DERIVA de ellas y la persona
    // pasa a repartir sus días por mes. Sin fechas, conserva la atribución
    // heredada: no se inventan períodos para un registro del que sólo se conoce
    // el total.
    const periods = input.absencePeriods ?? []
    const hasPeriods = periods.length > 0
    if (hasPeriods) {
      await tx.delete(preventionIncidentAbsencePeriods)
        .where(eq(preventionIncidentAbsencePeriods.personId, input.personId))
      await tx.insert(preventionIncidentAbsencePeriods).values(periods.map((period) => ({
        id: `incabs-${nanoid()}`,
        personId: input.personId,
        startDate: period.startDate,
        endDate: period.endDate ?? null,
        note: period.note ?? null,
        createdByUserId: args.access.ctx.userId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })))
    }
    const absenceDays = hasPeriods
      ? totalAbsenceDays(periods.map((period) => ({ startDate: period.startDate, endDate: period.endDate ?? null })), todayInChile())
      : input.absenceDays
    const absenceAllocation = hasPeriods ? "periods" : current.person.absenceAllocation
    const reopened = await invalidateClosedIndicatorPeriodWithClient(tx, {
      worksiteId: current.incident.worksiteId,
      occurredAt: current.incident.occurredAt,
      actorUserId: args.access.ctx.userId,
      reason: input.reason,
      permissions: args.access.permissions,
    })
    revocation = reopened.revocation
    const now = nowIso()
    const [person] = await tx.update(preventionIncidentPeople).set({
      absenceAtLeastNormalShift: input.absenceAtLeastNormalShift,
      absenceDays,
      absenceAllocation,
      chargeDays,
      administratorQualification: input.administratorQualification ?? null,
      indicatorInclusionStatus: input.inclusionStatus,
      indicatorInclusionReason: input.reason,
      indicatorClassifiedByUserId: input.inclusionStatus === "pending" ? null : args.access.ctx.userId,
      indicatorClassifiedAt: input.inclusionStatus === "pending" ? null : now,
      version: sql`${preventionIncidentPeople.version} + 1`,
      updatedAt: now,
    }).where(and(
      eq(preventionIncidentPeople.id, input.personId),
      eq(preventionIncidentPeople.version, input.expectedPersonVersion),
    )).returning()
    if (!person) throw new Error("La clasificación cambió; recarga antes de guardar.")
    const [incident] = await tx.update(preventionIncidents).set({
      version: sql`${preventionIncidents.version} + 1`,
      updatedAt: now,
    }).where(and(
      eq(preventionIncidents.id, input.incidentId),
      eq(preventionIncidents.version, input.expectedIncidentVersion),
    )).returning()
    if (!incident) throw new Error("El incidente cambió; recarga antes de guardar.")
    const beforeState = {
      absenceAtLeastNormalShift: current.person.absenceAtLeastNormalShift,
      absenceDays: current.person.absenceDays,
      chargeDays: current.person.chargeDays,
      administratorQualification: current.person.administratorQualification,
      inclusionStatus: current.person.indicatorInclusionStatus,
      version: current.person.version,
    }
    const afterState = {
      absenceAtLeastNormalShift: person.absenceAtLeastNormalShift,
      absenceDays: person.absenceDays,
      chargeDays: person.chargeDays,
      administratorQualification: person.administratorQualification,
      inclusionStatus: person.indicatorInclusionStatus,
      version: person.version,
    }
    await appendHistory(tx, {
      incidentId: incident.id,
      changeType: "correction",
      actorUserId: args.access.ctx.userId,
      reason: input.reason,
      changeSet: { personId: person.id, before: beforeState, after: afterState, formulaImpact: "ds44_indicators" },
      createdAt: now,
    })
    await recordModuleHistory(tx, {
      module: "safety_indicator",
      entityType: "incident_person",
      entityId: person.id,
      worksiteId: incident.worksiteId,
      changeType: "corrected",
      reason: input.reason,
      beforeState,
      afterState,
      actorUserId: args.access.ctx.userId,
      extra: {
        year: Number(CHILE_YEAR_FORMAT.format(new Date(incident.occurredAt))),
        month: Number(CHILE_MONTH_FORMAT.format(new Date(incident.occurredAt))),
      },
    })
    return { incident, person }
  })

  if (revocation) await onSafetyIndicatorPeriodReopened(revocation)
  return result
}

export async function listPreventionIncidents(args: {
  access: IncidentAccess
  status?: IncidentStatus
  worksiteId?: string
  year?: number
  monthFrom?: number
  monthTo?: number
  indicator?: "accidentability" | "frequency" | "severity" | "pending"
  limit?: number
}) {
  requireAccess(args.access, "prevention:incidents:view")
  if (args.worksiteId) requireAccess(args.access, "prevention:incidents:view", args.worksiteId)
  const conditions = [scopeCondition(args.access.scope)]
  if (args.status) conditions.push(eq(preventionIncidents.status, args.status))
  if (args.worksiteId) conditions.push(eq(preventionIncidents.worksiteId, args.worksiteId))
  if (args.year) conditions.push(sql`extract(year from ${preventionIncidents.occurredAt} at time zone 'America/Santiago')::int = ${args.year}`)
  if (args.monthFrom) conditions.push(sql`extract(month from ${preventionIncidents.occurredAt} at time zone 'America/Santiago')::int >= ${args.monthFrom}`)
  if (args.monthTo) conditions.push(sql`extract(month from ${preventionIncidents.occurredAt} at time zone 'America/Santiago')::int <= ${args.monthTo}`)
  if (args.indicator === "pending") {
    conditions.push(sql`exists (
      select 1 from ${preventionIncidentPeople} indicator_person
      where indicator_person.incident_id = ${preventionIncidents.id}
        and indicator_person.indicator_inclusion_status = 'pending'
    )`)
  } else if (args.indicator) {
    conditions.push(eq(preventionIncidents.eventType, "work_accident"))
    conditions.push(sql`exists (
      select 1 from ${preventionIncidentPeople} indicator_person
      where indicator_person.incident_id = ${preventionIncidents.id}
        and indicator_person.absence_at_least_normal_shift = true
        and indicator_person.indicator_inclusion_status in ('pending', 'included')
    )`)
  }
  return db.select({
    id: preventionIncidents.id,
    code: preventionIncidents.code,
    worksiteId: preventionIncidents.worksiteId,
    worksiteName: worksites.name,
    companyName: preventionIncidents.companyName,
    eventType: preventionIncidents.eventType,
    status: preventionIncidents.status,
    occurredAt: preventionIncidents.occurredAt,
    knownAt: preventionIncidents.knownAt,
    location: preventionIncidents.location,
    actualSeverity: preventionIncidents.actualSeverity,
    potentialSeverity: preventionIncidents.potentialSeverity,
    isFatalOrSerious: preventionIncidents.isFatalOrSerious,
    hasOverdueNotifications: sql<boolean>`exists (select 1 from ${preventionIncidentNotifications} notification_lane where notification_lane.incident_id = ${preventionIncidents.id} and notification_lane.status = 'overdue')`,
    source: preventionIncidents.source,
    version: preventionIncidents.version,
  }).from(preventionIncidents)
    .innerJoin(worksites, eq(worksites.id, preventionIncidents.worksiteId))
    .where(and(...conditions.filter(Boolean)))
    .orderBy(desc(preventionIncidents.occurredAt))
    .limit(Math.min(Math.max(args.limit ?? 500, 1), 2000))
}

export async function getPreventionIncidentDetail(args: {
  incidentId: string
  access: IncidentAccess
  includeSensitive?: boolean
  purpose?: string
}) {
  requireAccess(args.access, "prevention:incidents:view")
  const [incident] = await db.select({
    incident: preventionIncidents,
    worksiteName: worksites.name,
    reporterName: users.name,
  }).from(preventionIncidents)
    .innerJoin(worksites, eq(worksites.id, preventionIncidents.worksiteId))
    .innerJoin(users, eq(users.id, preventionIncidents.reportedByUserId))
    .where(and(eq(preventionIncidents.id, args.incidentId), scopeCondition(args.access.scope)))
    .limit(1)
  if (!incident) return null

  const [people, notifications, investigation, evidence, history, capa, absencePeriods] = await Promise.all([
    db.select().from(preventionIncidentPeople).where(eq(preventionIncidentPeople.incidentId, args.incidentId)).orderBy(asc(preventionIncidentPeople.createdAt)),
    db.select().from(preventionIncidentNotifications).where(eq(preventionIncidentNotifications.incidentId, args.incidentId)).orderBy(asc(preventionIncidentNotifications.notificationType)),
    db.select().from(preventionIncidentInvestigations).where(eq(preventionIncidentInvestigations.incidentId, args.incidentId)).limit(1),
    db.select().from(preventionIncidentEvidence).where(eq(preventionIncidentEvidence.incidentId, args.incidentId)).orderBy(asc(preventionIncidentEvidence.createdAt)),
    db.select().from(preventionIncidentHistory).where(eq(preventionIncidentHistory.incidentId, args.incidentId)).orderBy(asc(preventionIncidentHistory.createdAt)),
    db.select().from(preventionCapaActions).where(and(eq(preventionCapaActions.sourceType, "incident"), eq(preventionCapaActions.sourceId, args.incidentId))).orderBy(asc(preventionCapaActions.createdAt)),
    // Períodos de reposo, para que el formulario de clasificación muestre las
    // fechas ya registradas en vez de pedirlas de nuevo.
    db.select({
      personId: preventionIncidentAbsencePeriods.personId,
      startDate: preventionIncidentAbsencePeriods.startDate,
      endDate: preventionIncidentAbsencePeriods.endDate,
    }).from(preventionIncidentAbsencePeriods)
      .innerJoin(preventionIncidentPeople, eq(preventionIncidentPeople.id, preventionIncidentAbsencePeriods.personId))
      .where(eq(preventionIncidentPeople.incidentId, args.incidentId))
      .orderBy(asc(preventionIncidentAbsencePeriods.startDate)),
  ])
  const absenceByPerson = new Map<string, { startDate: string; endDate: string | null }>()
  for (const period of absencePeriods) {
    if (!absenceByPerson.has(period.personId)) absenceByPerson.set(period.personId, period)
  }

  let sensitivePeople: Array<{ personId: string; payload: Record<string, unknown> }> = []
  if (args.includeSensitive) {
    const purpose = args.purpose?.trim() ?? ""
    const granted = purpose.length >= 3
      && purpose.length <= 300
      && hasPermission(args.access.permissions, "prevention:incidents:view_sensitive")
      && scopeAllows(args.access.scope, incident.incident.worksiteId)
    if (!granted) {
      await auditIncidentSensitiveAccess({
        access: args.access,
        incidentId: args.incidentId,
        worksiteId: incident.incident.worksiteId,
        purpose: purpose || "sin propósito",
        outcome: "denied",
        reasonCode: "permission_scope_or_purpose",
      })
      throw new Error("Incidente no encontrado o fuera de alcance.")
    }
    const payloads = await db.select().from(preventionIncidentPersonSensitivePayloads)
      .innerJoin(preventionIncidentPeople, eq(preventionIncidentPeople.id, preventionIncidentPersonSensitivePayloads.personId))
      .where(eq(preventionIncidentPeople.incidentId, args.incidentId))
    sensitivePeople = payloads.map((entry) => ({
      personId: entry.prevention_incident_person_sensitive_payloads.personId,
      payload: decryptPreventionPayload<Record<string, unknown>>({
        encryptedPayload: entry.prevention_incident_person_sensitive_payloads.encryptedPayload,
        iv: entry.prevention_incident_person_sensitive_payloads.iv,
        authTag: entry.prevention_incident_person_sensitive_payloads.authTag,
        keyVersion: entry.prevention_incident_person_sensitive_payloads.keyVersion,
      }, `incident-person:${entry.prevention_incident_person_sensitive_payloads.personId}`),
    }))
    await auditIncidentSensitiveAccess({
      access: args.access,
      incidentId: args.incidentId,
      worksiteId: incident.incident.worksiteId,
      purpose,
      outcome: "granted",
    })
  }

  return {
    ...incident,
    people: people.map((person) => ({
      ...person,
      absenceStartDate: absenceByPerson.get(person.id)?.startDate ?? null,
      returnToWorkDate: absenceByPerson.get(person.id)?.endDate ?? null,
    })),
    sensitivePeople,
    notifications,
    investigation: investigation[0] ?? null,
    evidence: evidence.filter((item) => !item.isSensitive || args.includeSensitive),
    history,
    capa,
  }
}

const personSensitiveSchema = z.object({
  incidentId: z.string().min(1),
  personId: z.string().min(1),
  purpose: z.string().trim().min(3, "Indica el propósito del registro").max(300),
  sensitive: sensitivePersonSchema,
})

/**
 * Completa o corrige la ficha reservada (identidad, lesión) de una persona del
 * incidente. El formulario de reporte promete que esos datos se completan
 * después en la vista reservada, pero sólo el reporte los escribía: quien
 * reportaba sin ellos dejaba la ficha vacía para siempre.
 *
 * Mismo control que la lectura reservada: `view_sensitive` + faena, con
 * propósito declarado y una línea en la auditoría de acceso sensible, concedida
 * o denegada. El historial general dice qué campos se tocaron, nunca su valor.
 */
export async function savePreventionIncidentPersonSensitive(args: {
  input: unknown
  access: IncidentAccess
}) {
  const input = personSensitiveSchema.parse(args.input)
  const [target] = await db.select({ worksiteId: preventionIncidents.worksiteId }).from(preventionIncidents)
    .where(eq(preventionIncidents.id, input.incidentId)).limit(1)
  if (!target) throw new Error("Incidente no encontrado o fuera de alcance.")
  if (!hasPermission(args.access.permissions, "prevention:incidents:view_sensitive") || !scopeAllows(args.access.scope, target.worksiteId)) {
    await auditIncidentSensitiveAccess({
      access: args.access,
      incidentId: input.incidentId,
      worksiteId: target.worksiteId,
      purpose: input.purpose,
      outcome: "denied",
      reasonCode: "permission_or_scope",
      action: "update",
    })
    throw new Error("Incidente no encontrado o fuera de alcance.")
  }

  return db.transaction(async (tx) => {
    const incident = await findIncidentForMutation(tx, input.incidentId)
    const [person] = await tx.select({ id: preventionIncidentPeople.id, workerId: preventionIncidentPeople.workerId })
      .from(preventionIncidentPeople)
      .where(and(eq(preventionIncidentPeople.id, input.personId), eq(preventionIncidentPeople.incidentId, incident.id)))
      .limit(1)
    if (!person) throw new Error("Persona del incidente no encontrada o fuera de alcance.")
    const [existing] = await tx.select({ id: preventionIncidentPersonSensitivePayloads.id })
      .from(preventionIncidentPersonSensitivePayloads)
      .where(eq(preventionIncidentPersonSensitivePayloads.personId, person.id)).limit(1)
    const now = nowIso()
    // Mismo contexto de cifrado que el reporte: la lectura reservada no distingue
    // una ficha nacida al reportar de una completada después.
    const encrypted = encryptPreventionPayload(input.sensitive, `incident-person:${person.id}`)
    await tx.insert(preventionIncidentPersonSensitivePayloads).values({
      id: `incps-${nanoid()}`,
      personId: person.id,
      ...encrypted,
      createdByUserId: args.access.ctx.userId,
      updatedByUserId: args.access.ctx.userId,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: preventionIncidentPersonSensitivePayloads.personId,
      set: { ...encrypted, updatedByUserId: args.access.ctx.userId, updatedAt: now },
    })
    const action = existing ? "update" : "create"
    await appendHistory(tx, {
      incidentId: incident.id,
      changeType: "person",
      actorUserId: args.access.ctx.userId,
      reason: existing ? "Ficha reservada de la persona actualizada" : "Ficha reservada de la persona completada",
      changeSet: {
        personId: person.id,
        sensitiveFields: Object.entries(input.sensitive).filter(([, value]) => Boolean(value)).map(([key]) => key),
      },
      createdAt: now,
    })
    await auditIncidentSensitiveAccess({
      access: args.access,
      incidentId: incident.id,
      worksiteId: incident.worksiteId,
      workerId: person.workerId,
      purpose: input.purpose,
      outcome: "granted",
      action,
      client: tx,
    })
    return { incidentId: incident.id, personId: person.id, action }
  })
}

export async function triagePreventionIncident(args: {
  input: unknown
  access: IncidentAccess
}) {
  requireAccess(args.access, "prevention:incidents:triage")
  const input = triageSchema.parse(args.input)
  const updated = await db.transaction(async (tx) => {
    const incident = await findIncidentForMutation(tx, input.incidentId)
    requireAccess(args.access, "prevention:incidents:triage", incident.worksiteId)
    if (incident.status !== "reported") throw new Error("El incidente ya fue sometido a triage.")
    if (input.isFatalOrSerious && !input.operationsSuspended) throw new Error("Un evento fatal/grave exige suspensión de la operación.")
    if (input.notificationResponsibleUserId) {
      const [responsible] = await tx.select({ id: users.id }).from(users)
        .where(and(eq(users.id, input.notificationResponsibleUserId), eq(users.isActive, true))).limit(1)
      if (!responsible) throw new Error("El responsable de notificación no existe o está inactivo.")
    }
    const now = nowIso()
    const [updated] = await tx.update(preventionIncidents).set({
      status: "triage",
      actualSeverity: input.actualSeverity,
      potentialSeverity: input.potentialSeverity,
      isFatalOrSerious: input.isFatalOrSerious,
      operationsSuspended: input.operationsSuspended,
      evacuated: input.evacuated,
      immediateMeasures: input.immediateMeasures,
      triagedAt: now,
      triagedByUserId: args.access.ctx.userId,
      version: sql`${preventionIncidents.version} + 1`,
      updatedAt: now,
    }).where(and(eq(preventionIncidents.id, input.incidentId), eq(preventionIncidents.version, input.expectedVersion))).returning()
    if (!updated) throw new Error("El incidente cambió mientras realizabas el triage; recarga e intenta nuevamente.")

    await createNotificationLanes(tx, {
      incidentId: incident.id,
      eventType: incident.eventType as IncidentEventType,
      isFatalOrSerious: input.isFatalOrSerious,
      knownAt: incident.knownAt,
      responsibleUserId: input.notificationResponsibleUserId,
      administratorName: input.administratorName,
      now,
    })
    await updateNotificationAssignment(tx, {
      incidentId: incident.id,
      responsibleUserId: input.notificationResponsibleUserId,
      administratorName: input.administratorName,
      now,
    })
    // Si el reporte nació fatal/grave, sus carriles DT, SEREMI y reinicio ya
    // existen. Un triage que lo baja no los borra —el insert es idempotente—, y
    // el cierre sólo acepta carriles enviados, autorizados o no requeridos: el
    // incidente quedaba sin poder cerrarse nunca. Se liberan los que siguen
    // abiertos; uno ya enviado o autorizado es un hecho y se conserva.
    const releasedNotificationLanes = input.isFatalOrSerious
      ? []
      : (await tx.update(preventionIncidentNotifications).set({
        status: "not_required",
        updatedAt: now,
      }).where(and(
        eq(preventionIncidentNotifications.incidentId, incident.id),
        inArray(preventionIncidentNotifications.notificationType, FATAL_OR_SERIOUS_LANES),
        inArray(preventionIncidentNotifications.status, ["pending", "overdue"]),
      )).returning({ notificationType: preventionIncidentNotifications.notificationType }))
        .map((lane) => lane.notificationType)
    await appendHistory(tx, {
      incidentId: incident.id,
      changeType: "triage",
      actorUserId: args.access.ctx.userId,
      fromStatus: incident.status,
      toStatus: "triage",
      reason: input.reason,
      changeSet: {
        actualSeverity: input.actualSeverity,
        potentialSeverity: input.potentialSeverity,
        isFatalOrSerious: input.isFatalOrSerious,
        operationsSuspended: input.operationsSuspended,
        evacuated: input.evacuated,
        notificationResponsibleUserId: input.notificationResponsibleUserId ?? null,
        ...(releasedNotificationLanes.length > 0 ? { releasedNotificationLanes } : {}),
      },
      createdAt: now,
    })
    return updated
  })

  // Reconciliación PDTP best-effort tras el triage (fuera de la transacción,
  // mismo patrón que `onIncidentReported` en `reportPreventionIncident`): si
  // la reclasificación bajó la severidad al punto de que una obligación del
  // RE-20 ya creada dejó de aplicar, se cancela con motivo trazable.
  await reconcileIncidentObligationsAfterTriage({
    incidentId: updated.id,
    worksiteId: updated.worksiteId,
    occurredAt: updated.createdAt,
    userId: args.access.ctx.userId,
    eventType: updated.eventType as IncidentEventType,
    actualSeverity: updated.actualSeverity,
    potentialSeverity: updated.potentialSeverity,
    isFatalOrSerious: updated.isFatalOrSerious,
  })

  return updated
}

async function getClosureFacts(client: IncidentClient, incidentId: string) {
  const [investigations, notifications, capa] = await Promise.all([
    client.select().from(preventionIncidentInvestigations).where(eq(preventionIncidentInvestigations.incidentId, incidentId)),
    client.select().from(preventionIncidentNotifications).where(eq(preventionIncidentNotifications.incidentId, incidentId)),
    client.select().from(preventionCapaActions).where(and(eq(preventionCapaActions.sourceType, "incident"), eq(preventionCapaActions.sourceId, incidentId))),
  ])
  return { investigation: investigations[0] ?? null, notifications, capa }
}

export function assertIncidentTransition(args: {
  incident: Pick<typeof preventionIncidents.$inferSelect, "status" | "eventType" | "actualSeverity" | "potentialSeverity" | "isFatalOrSerious" | "immediateMeasures">
  toStatus: IncidentStatus
  permissions: readonly string[]
  investigationCompleted: boolean
  /**
   * Quién dio la investigación por completada, y quién intenta cerrar.
   *
   * El cierre es la evidencia que ve el fiscalizador, y hasta ahora sus cuatro
   * compuertas comprobaban el estado del caso sin mirar quién firma: el mismo
   * que investigó podía cerrarlo. Se pasan los dos usuarios en vez de un
   * booleano ya resuelto para que la regla viva junto a las otras compuertas y
   * no se pierda en el llamador.
   */
  investigationCompletedByUserId: string | null
  actorUserId: string
  capaStatuses: readonly string[]
  notificationLanes: ReadonlyArray<{ notificationType: string; status: string; evidenceReference: string | null }>
}) {
  const from = args.incident.status as IncidentStatus
  if (!TRANSITIONS[from]?.includes(args.toStatus)) throw new Error(`Transición de incidente inválida: ${from} → ${args.toStatus}.`)
  if (!hasPermission(args.permissions, TRANSITION_PERMISSION[args.toStatus])) throw new Error("Incidente no encontrado o fuera de alcance.")
  if (args.toStatus === "immediate_measures" && (args.incident.immediateMeasures?.trim().length ?? 0) < 3) {
    throw new Error("Debes documentar las medidas inmediatas antes de avanzar.")
  }
  if (args.toStatus === "pending_capa" && incidentRequiresInvestigation(args.incident) && !args.investigationCompleted) {
    throw new Error("La clasificación exige completar la investigación antes de pasar a CAPA.")
  }
  if (args.toStatus === "pending_verification" && incidentRequiresCapa(args.incident)) {
    if (args.capaStatuses.length === 0) throw new Error("La clasificación exige al menos una acción CAPA.")
    if (args.capaStatuses.some((status) => !["verified", "closed"].includes(status))) {
      throw new Error("Todas las acciones CAPA deben estar verificadas antes de la verificación del incidente.")
    }
  }
  if (args.toStatus === "closed") {
    if (incidentRequiresInvestigation(args.incident) && !args.investigationCompleted) throw new Error("No se puede cerrar sin investigación completada.")
    if (args.capaStatuses.some((status) => status !== "closed")) throw new Error("Todas las acciones CAPA deben estar cerradas.")
    const blocked = args.notificationLanes.filter((lane) => !["sent", "acknowledged", "not_required", "authorized"].includes(lane.status))
    if (blocked.length > 0) throw new Error("No se puede cerrar con denuncias, notificaciones o reinicio pendientes/atrasados.")
    // El carril de reinicio YA NO está exento: desde NORM-06 su autorización
    // exige evidencia de la autoridad, así que el cierre puede verificarla como
    // a cualquier otro carril.
    const missingEvidence = args.notificationLanes.filter((lane) => lane.status !== "not_required" && !lane.evidenceReference)
    if (missingEvidence.length > 0) throw new Error("Las denuncias/notificaciones requieren evidencia antes del cierre.")
    /* Quinta compuerta, y la única sobre personas: quien completó la
     * investigación no la da por cerrada. Las otras cuatro miran el estado del
     * caso; ésta mira quién firma, que es lo que un expediente cerrado tiene
     * que poder demostrar. La jefatura técnica del área queda exenta: responde
     * por la investigación y no puede quedar esperando una firma ajena. */
    /* INC-002: la excepción deja rastro. Antes era un booleano y un cierre
     * firmado por quien investigó quedaba en el expediente idéntico a uno
     * firmado por dos personas distintas. */
    const signing = resolveOwnWorkSigning({
      signedByUserId: args.investigationCompletedByUserId,
      actorUserId: args.actorUserId,
      permissions: args.permissions,
      what: "Cerrar el incidente",
    })
    if (!signing.ok) {
      throw new Error("Quien completó la investigación no puede cerrar el incidente: debe firmarlo otra persona.")
    }
    return { ownWorkExceptionUsed: signing.usedException }
  }
  return { ownWorkExceptionUsed: false }
}

export async function transitionPreventionIncident(args: {
  input: unknown
  access: IncidentAccess
}) {
  const input = transitionSchema.parse(args.input)
  const updated = await db.transaction(async (tx) => {
    const incident = await findIncidentForMutation(tx, input.incidentId)
    requireAccess(args.access, TRANSITION_PERMISSION[input.toStatus], incident.worksiteId)
    const facts = await getClosureFacts(tx, incident.id)
    const { ownWorkExceptionUsed } = assertIncidentTransition({
      incident,
      toStatus: input.toStatus,
      permissions: args.access.permissions,
      investigationCompleted: facts.investigation?.status === "completed",
      investigationCompletedByUserId: facts.investigation?.completedByUserId ?? null,
      actorUserId: args.access.ctx.userId,
      capaStatuses: facts.capa.map((item) => item.status),
      notificationLanes: facts.notifications,
    })
    const now = nowIso()
    const [updated] = await tx.update(preventionIncidents).set({
      status: input.toStatus,
      version: sql`${preventionIncidents.version} + 1`,
      updatedAt: now,
      ...(input.toStatus === "closed" ? {
        closedAt: now,
        closedByUserId: args.access.ctx.userId,
        closureReason: input.reason,
      } : {}),
    }).where(and(eq(preventionIncidents.id, incident.id), eq(preventionIncidents.version, input.expectedVersion))).returning()
    if (!updated) throw new Error("El incidente cambió; recarga e intenta nuevamente.")
    await appendHistory(tx, {
      incidentId: incident.id,
      changeType: input.toStatus === "closed" ? "closure" : "status",
      actorUserId: args.access.ctx.userId,
      fromStatus: incident.status,
      toStatus: input.toStatus,
      // INC-002: si el cierre lo firmó quien completó la investigación, el
      // expediente dice que se usó la excepción `prevention:sign_own_work` y
      // no sólo que alguien cerró.
      reason: ownWorkExceptionUsed
        ? `${input.reason} [Firma propia: cerrado por quien completó la investigación, con la excepción prevention:sign_own_work.]`
        : input.reason,
      createdAt: now,
    })
    // El expediente cerrado queda en Cloudreve, sin la hoja de datos
    // reservados. El cierre es terminal: una sola copia por incidente.
    if (input.toStatus === "closed") {
      await enqueueGeneratedDocumentTx(tx, {
        kind: "incidente",
        entityId: updated.id,
        milestone: "cerrado",
        worksiteId: updated.worksiteId,
        occurredAt: now,
        actorUserId: args.access.ctx.userId,
      })
    }
    return updated
  })

  // Auto-acreditación PDTP (Actividad 77: expediente cerrado/archivado), fuera
  // de la transacción para no dejar una ejecución huérfana ante un rollback.
  if (updated.status === "closed" && updated.closedAt) {
    await onIncidentClosed({ incidentId: updated.id, worksiteId: updated.worksiteId, closedAt: updated.closedAt, userId: args.access.ctx.userId })
  }

  return updated
}

export async function savePreventionIncidentInvestigation(args: {
  input: unknown
  access: IncidentAccess
}) {
  requireAccess(args.access, "prevention:incidents:investigate")
  const input = investigationSchema.parse(args.input)
  const result = await db.transaction(async (tx) => {
    const incident = await findIncidentForMutation(tx, input.incidentId)
    requireAccess(args.access, "prevention:incidents:investigate", incident.worksiteId)
    if (!["immediate_measures", "under_investigation", "pending_capa"].includes(incident.status)) {
      throw new Error("El incidente no está en una etapa que permita investigar.")
    }
    const existing = await tx.select().from(preventionIncidentInvestigations)
      .where(eq(preventionIncidentInvestigations.incidentId, incident.id)).limit(1)
    const now = nowIso()
    const encryptedInterviews = input.interviews
      ? encryptPreventionPayload(input.interviews, `incident-investigation:${existing[0]?.id ?? incident.id}`)
      : null
    const investigationId = existing[0]?.id ?? `inci-${nanoid()}`
    // Con el incidente en CAPA, la investigación completa es la compuerta que lo
    // dejó pasar. Desmarcarla la volvía "en curso" y borraba quién y cuándo la
    // cerró, mientras el incidente seguía avanzando sobre esa base.
    if (!input.complete && existing[0]?.status === "completed" && incident.status === "pending_capa") {
      throw new Error("La investigación ya está completa y el incidente avanzó a CAPA: no puede volver a quedar en curso. Mantén marcada «investigación completa» para guardar cambios.")
    }
    let miperTrigger: typeof preventionRiskReviewTriggers.$inferSelect | null = null
    if (input.miperUpdateRequired) {
      const triggerType = incident.eventType === "suspected_occupational_disease"
        ? "occupational_disease"
        : incident.eventType === "work_accident"
          ? "work_accident"
          : incident.isFatalOrSerious
            ? "grave_imminent"
            : "work_change"
      miperTrigger = await createRiskReviewTriggerWithClient(tx, {
        worksiteId: incident.worksiteId,
        triggerType,
        sourceType: "incident",
        sourceId: incident.id,
        description: `Revisar y publicar la MIPER por el incidente ${incident.code}. Plazo operacional interno: 10 días.`,
        assignedToUserId: args.access.ctx.userId,
        // Plazo civil chileno: en UTC, entre las 20:00 y la medianoche de Chile
        // el plazo contaba desde mañana y regalaba un día.
        dueAt: addDaysToPlainDate(todayInChile(), 10),
        idempotencyKey: `incident:miper:${incident.id}`,
      }, args.access.ctx.userId)
    }
    const miperUpdateVerified = !input.miperUpdateRequired || miperTrigger?.status === "completed"
    if (input.miperUpdated && !miperUpdateVerified) throw new Error("No puedes declarar la MIPER actualizada: el disparador exige una nueva versión publicada y vinculada.")
    const values = {
      status: input.complete ? "completed" : (existing[0] ? "in_progress" : "draft"),
      methodology: input.methodology,
      team: input.team,
      evidenceSummary: input.evidenceSummary ?? null,
      immediateCauses: input.immediateCauses,
      basicCauses: input.basicCauses,
      organizationalCauses: input.organizationalCauses,
      failedControls: input.failedControls,
      conclusions: input.conclusions ?? null,
      ...(encryptedInterviews ? {
        interviewsEncrypted: encryptedInterviews.encryptedPayload,
        interviewsIv: encryptedInterviews.iv,
        interviewsAuthTag: encryptedInterviews.authTag,
        interviewsKeyVersion: encryptedInterviews.keyVersion,
      } : {}),
      // Volver a guardar con la marca puesta conserva cuándo se registró (y
      // quién cerró): esas fechas son la evidencia del hecho, no del guardado.
      miperUpdateRequired: input.miperUpdateRequired,
      miperUpdatedAt: input.miperUpdated && miperUpdateVerified ? (existing[0]?.miperUpdatedAt ?? now) : null,
      procedureUpdateRequired: input.procedureUpdateRequired,
      procedureUpdatedAt: input.procedureUpdated ? (existing[0]?.procedureUpdatedAt ?? now) : null,
      trainingRequired: input.trainingRequired,
      trainingCompletedAt: input.trainingCompleted ? (existing[0]?.trainingCompletedAt ?? now) : null,
      completedByUserId: input.complete ? (existing[0]?.completedAt ? existing[0].completedByUserId : args.access.ctx.userId) : null,
      completedAt: input.complete ? (existing[0]?.completedAt ?? now) : null,
      updatedAt: now,
    }
    if (input.complete) {
      if ((input.conclusions?.length ?? 0) < 10) throw new Error("La investigación requiere conclusiones suficientes.")
      if (input.immediateCauses.length + input.basicCauses.length + input.organizationalCauses.length === 0) {
        throw new Error("La investigación requiere al menos una causa identificada.")
      }
      if (input.miperUpdateRequired && !miperUpdateVerified) throw new Error("Debes completar el disparador MIPER con una nueva versión publicada antes de cerrar la investigación.")
      if (input.procedureUpdateRequired && !input.procedureUpdated) throw new Error("Debes registrar la actualización de procedimiento requerida.")
      if (input.trainingRequired && !input.trainingCompleted) throw new Error("Debes registrar la capacitación requerida.")
    }

    if (existing[0]) {
      await tx.update(preventionIncidentInvestigations).set({
        ...values,
        version: sql`${preventionIncidentInvestigations.version} + 1`,
      }).where(eq(preventionIncidentInvestigations.id, investigationId))
    } else {
      await tx.insert(preventionIncidentInvestigations).values({
        id: investigationId,
        incidentId: incident.id,
        ...values,
        startedByUserId: args.access.ctx.userId,
        startedAt: now,
        version: 1,
      })
    }
    const [updatedIncident] = await tx.update(preventionIncidents).set({
      status: incident.status === "immediate_measures" ? "under_investigation" : incident.status,
      version: sql`${preventionIncidents.version} + 1`,
      updatedAt: now,
    }).where(and(eq(preventionIncidents.id, incident.id), eq(preventionIncidents.version, input.expectedIncidentVersion))).returning()
    if (!updatedIncident) throw new Error("El incidente cambió; recarga e intenta nuevamente.")
    await appendHistory(tx, {
      incidentId: incident.id,
      changeType: "investigation",
      actorUserId: args.access.ctx.userId,
      fromStatus: incident.status,
      toStatus: updatedIncident.status,
      reason: input.reason,
      changeSet: {
        investigationId,
        status: values.status,
        methodology: input.methodology,
        causes: input.immediateCauses.length + input.basicCauses.length + input.organizationalCauses.length,
        controlsFailed: input.failedControls.length,
      },
      createdAt: now,
    })
    return { incident: updatedIncident, investigationId, completed: input.complete }
  })

  // Auto-acreditación PDTP (Actividades 73/74: investigación definitiva completada
  // e informe enviado), fuera de la transacción.
  if (result.completed) {
    await onIncidentInvestigationCompleted({
      incidentId: result.incident.id,
      worksiteId: result.incident.worksiteId,
      completedAt: result.incident.updatedAt,
      userId: args.access.ctx.userId,
    })
  }

  return { incident: result.incident, investigationId: result.investigationId }
}

export async function addPreventionIncidentEvidence(args: {
  input: unknown
  access: IncidentAccess
}) {
  requireAccess(args.access, "prevention:incidents:investigate")
  const input = evidenceSchema.parse(args.input)
  return db.transaction(async (tx) => {
    const incident = await findIncidentForMutation(tx, input.incidentId)
    requireAccess(args.access, "prevention:incidents:investigate", incident.worksiteId)
    if (input.isSensitive && !hasPermission(args.access.permissions, "prevention:incidents:view_sensitive")) {
      throw new Error("No tienes autorización para clasificar evidencia sensible.")
    }
    if (input.investigationId) {
      const [investigation] = await tx.select({ id: preventionIncidentInvestigations.id }).from(preventionIncidentInvestigations)
        .where(and(eq(preventionIncidentInvestigations.id, input.investigationId), eq(preventionIncidentInvestigations.incidentId, incident.id))).limit(1)
      if (!investigation) throw new Error("La investigación no pertenece al incidente.")
    }
    const now = nowIso()
    const [created] = await tx.insert(preventionIncidentEvidence).values({
      id: `ince-${nanoid()}`,
      incidentId: incident.id,
      investigationId: input.investigationId ?? null,
      kind: input.kind,
      reference: input.reference,
      description: input.description ?? null,
      checksumSha256: input.checksumSha256 ?? null,
      isSensitive: input.isSensitive,
      capturedAt: input.capturedAt ?? null,
      createdByUserId: args.access.ctx.userId,
      createdAt: now,
    }).returning()
    if (!created) throw new Error("No se pudo registrar la evidencia del incidente.")
    const [updated] = await tx.update(preventionIncidents).set({
      version: sql`${preventionIncidents.version} + 1`, updatedAt: now,
    }).where(and(eq(preventionIncidents.id, incident.id), eq(preventionIncidents.version, input.expectedVersion))).returning()
    if (!updated) throw new Error("El incidente cambió; recarga e intenta nuevamente.")
    await appendHistory(tx, {
      incidentId: incident.id,
      changeType: "evidence",
      actorUserId: args.access.ctx.userId,
      reason: "Evidencia agregada",
      changeSet: { evidenceId: created.id, kind: created.kind, isSensitive: created.isSensitive },
      createdAt: now,
    })
    return { incident: updated, evidence: created }
  })
}

export async function recordPreventionIncidentNotification(args: {
  input: unknown
  access: IncidentAccess
}) {
  requireAccess(args.access, "prevention:incidents:notify")
  const input = notificationSchema.parse(args.input)
  const updated = await db.transaction(async (tx) => {
    const incident = await findIncidentForMutation(tx, input.incidentId)
    requireAccess(args.access, "prevention:incidents:notify", incident.worksiteId)
    const [lane] = await tx.select().from(preventionIncidentNotifications).where(and(
      eq(preventionIncidentNotifications.incidentId, incident.id),
      eq(preventionIncidentNotifications.notificationType, input.notificationType),
    )).limit(1)
    if (!lane) throw new Error("La denuncia/notificación no aplica a este incidente.")
    const now = nowIso()
    const wasLate = Boolean(lane.deadlineAt && new Date(input.sentAt).getTime() > new Date(lane.deadlineAt).getTime())
    await tx.update(preventionIncidentNotifications).set({
      status: "sent",
      sentAt: input.sentAt,
      evidenceReference: input.evidenceReference,
      evidenceChecksumSha256: input.evidenceChecksumSha256 ?? null,
      administratorName: input.administratorName ?? lane.administratorName,
      observations: input.observations ?? null,
      escalatedAt: wasLate ? (lane.escalatedAt ?? lane.deadlineAt) : lane.escalatedAt,
      updatedAt: now,
    }).where(eq(preventionIncidentNotifications.id, lane.id))
    const [updated] = await tx.update(preventionIncidents).set({
      version: sql`${preventionIncidents.version} + 1`, updatedAt: now,
    }).where(and(eq(preventionIncidents.id, incident.id), eq(preventionIncidents.version, input.expectedVersion))).returning()
    if (!updated) throw new Error("El incidente cambió; recarga e intenta nuevamente.")
    await appendHistory(tx, {
      incidentId: incident.id,
      changeType: "notification",
      actorUserId: args.access.ctx.userId,
      reason: wasLate ? "Notificación registrada fuera de plazo" : "Notificación registrada",
      changeSet: {
        type: lane.notificationType,
        sentAt: input.sentAt,
        deadlineAt: lane.deadlineAt,
        wasLate,
        before: { sentAt: lane.sentAt, evidenceReference: lane.evidenceReference, evidenceChecksumSha256: lane.evidenceChecksumSha256 },
      },
      createdAt: now,
    })
    return updated
  })

  // Auto-acreditación PDTP (Actividad 72: DIAT emitida), fuera de la transacción.
  if (input.notificationType === "diat") {
    await onIncidentDiatIssued({ incidentId: updated.id, worksiteId: updated.worksiteId, issuedAt: input.sentAt, userId: args.access.ctx.userId })
  }

  return updated
}

export async function authorizePreventionIncidentRestart(args: {
  input: unknown
  access: IncidentAccess
}) {
  requireAccess(args.access, "prevention:incidents:authorize_restart")
  const input = restartSchema.parse(args.input)
  return db.transaction(async (tx) => {
    const incident = await findIncidentForMutation(tx, input.incidentId)
    requireAccess(args.access, "prevention:incidents:authorize_restart", incident.worksiteId)
    if (!incident.isFatalOrSerious || !incident.operationsSuspended) throw new Error("El incidente no requiere autorización formal de reinicio.")
    const facts = await getClosureFacts(tx, incident.id)
    if (facts.investigation?.status !== "completed") throw new Error("El reinicio exige investigación completada.")
    if (facts.capa.length === 0 || facts.capa.some((action) => !["verified", "closed"].includes(action.status))) {
      throw new Error("El reinicio exige CAPA verificada.")
    }
    const requiredAuthorities = facts.notifications.filter((lane) => ["fatal_dt", "fatal_seremi"].includes(lane.notificationType))
    if (requiredAuthorities.some((lane) => !["sent", "acknowledged"].includes(lane.status) || !lane.evidenceReference)) {
      throw new Error("El reinicio exige evidencia de notificación a DT y SEREMI.")
    }
    const restart = facts.notifications.find((lane) => lane.notificationType === "restart_authorization")
    if (!restart) throw new Error("No existe carril de autorización de reinicio.")
    // Segregación por identidad, misma política que CAPA: quien investigó o
    // implementó/verificó las medidas no puede autorizar su propio reinicio.
    const conflicted = new Set([
      ...(facts.investigation?.team ?? []).map((member) => member.userId),
      ...facts.capa.flatMap((action) => [action.responsibleUserId, action.completedByUserId, action.verifiedByUserId]),
    ].filter((userId): userId is string => Boolean(userId)))
    let segregationOverride: { reason: string; actorUserId: string } | null = null
    if (conflicted.has(args.access.ctx.userId)) {
      const canOverride = hasPermission(args.access.permissions, "prevention:incidents:override_segregation")
      if (!canOverride || (input.segregationExceptionReason?.trim().length ?? 0) < 10) {
        throw new Error("El reinicio debe autorizarlo alguien que no participó en la investigación ni implementó/verificó las medidas.")
      }
      segregationOverride = { reason: input.segregationExceptionReason!, actorUserId: args.access.ctx.userId }
    }
    const now = nowIso()
    // La evidencia de la autoridad se persiste en el propio carril: es lo que un
    // fiscalizador pedirá para validar que la reanudación fue autorizada.
    await tx.update(preventionIncidentNotifications).set({
      status: "authorized",
      administratorName: input.authorityName,
      evidenceReference: input.evidenceReference,
      evidenceChecksumSha256: input.evidenceChecksumSha256 ?? null,
      sentAt: `${input.authorizationDate}T00:00:00.000Z`,
      restartAuthorizedAt: now,
      restartAuthorizedByUserId: args.access.ctx.userId,
      restartAuthorizationReason: `${input.reason} · ${input.authorityName} ${input.authorizationReference} (${input.authorizationDate})`,
      updatedAt: now,
    }).where(eq(preventionIncidentNotifications.id, restart.id))
    const [updated] = await tx.update(preventionIncidents).set({
      operationsSuspended: false,
      version: sql`${preventionIncidents.version} + 1`,
      updatedAt: now,
    }).where(and(eq(preventionIncidents.id, incident.id), eq(preventionIncidents.version, input.expectedVersion))).returning()
    if (!updated) throw new Error("El incidente cambió; recarga e intenta nuevamente.")
    await appendHistory(tx, {
      incidentId: incident.id,
      changeType: "restart",
      actorUserId: args.access.ctx.userId,
      reason: input.reason,
      changeSet: {
        restartAuthorizedAt: now,
        segregationOverride,
        authorityName: input.authorityName,
        authorizationReference: input.authorizationReference,
        authorizationDate: input.authorizationDate,
      },
      createdAt: now,
    })
    return updated
  })
}

type CapaInput = z.infer<typeof capaSchema>

/** Crea la CAPA y sube la versión del incidente dentro de la transacción del llamador. */
async function createIncidentCapaInTx(tx: IncidentClient, args: {
  incident: typeof preventionIncidents.$inferSelect
  input: CapaInput
  userId: string
}) {
  const { incident, input } = args
  const now = nowIso()
  const [capa, [updated]] = await Promise.all([
    createCapaActionWithClient(tx, {
      sourceType: "incident",
      sourceId: incident.id,
      sourceItemId: input.sourceItemId ?? null,
      worksiteId: incident.worksiteId,
      finding: input.finding,
      immediateMeasure: input.immediateMeasure ?? null,
      rootCause: input.rootCause ?? null,
      actionDescription: input.actionDescription,
      responsibleUserId: input.responsibleUserId ?? null,
      responsibleSnapshot: input.responsibleSnapshot ?? null,
      responsibleRole: input.responsibleRole ?? null,
      priority: input.priority,
      targetDate: input.targetDate,
      evidenceRequired: input.evidenceRequired,
      evidenceExemptionReason: input.evidenceExemptionReason ?? null,
    }, args.userId),
    tx.update(preventionIncidents).set({
      version: sql`${preventionIncidents.version} + 1`, updatedAt: now,
    }).where(and(eq(preventionIncidents.id, incident.id), eq(preventionIncidents.version, input.expectedVersion))).returning(),
  ])
  if (!updated) throw new Error("El incidente cambió; recarga e intenta nuevamente.")
  await appendHistory(tx, {
    incidentId: incident.id,
    changeType: "capa",
    actorUserId: args.userId,
    reason: "Acción CAPA creada desde la investigación",
    changeSet: { capaActionId: capa.id, code: capa.code, priority: capa.priority },
    createdAt: now,
  })
  return { incident: updated, capa }
}

export async function createPreventionIncidentCapa(args: {
  input: unknown
  access: IncidentAccess
}) {
  requireAccess(args.access, "prevention:incidents:investigate")
  requireAccess(args.access, "prevention:capa:manage")
  const input = capaSchema.parse(args.input)
  return db.transaction(async (tx) => {
    const incident = await findIncidentForMutation(tx, input.incidentId)
    requireAccess(args.access, "prevention:incidents:investigate", incident.worksiteId)
    return createIncidentCapaInTx(tx, { incident, input, userId: args.access.ctx.userId })
  })
}

export async function markOverdueIncidentNotifications(args: {
  now?: Date
  client?: IncidentClient
}) {
  const client = args.client ?? db
  const now = (args.now ?? new Date()).toISOString()
  const due = await client.select().from(preventionIncidentNotifications).where(and(
    inArray(preventionIncidentNotifications.status, ["pending", "overdue"]),
    lte(preventionIncidentNotifications.deadlineAt, now),
  ))
  const newlyOverdue = due.filter((lane) => lane.status === "pending")
  for (const lane of newlyOverdue) {
    await client.update(preventionIncidentNotifications).set({
      status: "overdue",
      escalatedAt: lane.escalatedAt ?? now,
      updatedAt: now,
    }).where(eq(preventionIncidentNotifications.id, lane.id))
  }
  return { due, newlyOverdue }
}

export async function listIncidentWorksites(
  access: IncidentAccess,
  permission: "prevention:incidents:view" | "prevention:incidents:report" | "prevention:incidents:triage" = "prevention:incidents:view",
) {
  requireAccess(access, permission)
  const condition = access.scope.mode === "all"
    ? eq(worksites.isActive, true)
    : access.scope.mode === "some" && access.scope.ids.length > 0
      ? and(eq(worksites.isActive, true), inArray(worksites.id, access.scope.ids))
      : sql`false`
  return db.select({ id: worksites.id, name: worksites.name, code: worksites.code })
    .from(worksites).where(condition).orderBy(asc(worksites.name))
}

export async function getIncidentDashboardCounts(access: IncidentAccess) {
  requireAccess(access, "prevention:incidents:view")
  const condition = scopeCondition(access.scope)
  const [row] = await db.select({
    totalOpen: sql<number>`count(*) filter (where ${preventionIncidents.status} <> 'closed')::int`,
    overdueNotifications: sql<number>`count(distinct ${preventionIncidents.id}) filter (where exists (select 1 from ${preventionIncidentNotifications} n where n.incident_id = ${preventionIncidents.id} and n.status = 'overdue'))::int`,
    fatalOrSerious: sql<number>`count(*) filter (where ${preventionIncidents.isFatalOrSerious} = true and ${preventionIncidents.status} <> 'closed')::int`,
    pendingInvestigation: sql<number>`count(*) filter (where ${preventionIncidents.status} in ('immediate_measures', 'under_investigation'))::int`,
  }).from(preventionIncidents).where(condition)
  return row ?? { totalOpen: 0, overdueNotifications: 0, fatalOrSerious: 0, pendingInvestigation: 0 }
}

export async function listIncidentNotificationResponsibles(access: IncidentAccess, worksiteId: string) {
  requireAccess(access, "prevention:incidents:triage", worksiteId)
  const ids = await getUserIdsWithPermissionForWorksite("prevention:incidents:notify", worksiteId)
  if (ids.length === 0) return []
  return db.select({ id: users.id, name: users.name, email: users.email }).from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true))).orderBy(asc(users.name))
}

/**
 * Personas que pueden integrar el equipo, responder o verificar en el RE-20 de
 * una faena: quienes ven incidentes de esa faena. Nombre y cargo (de su ficha de
 * trabajador): la interfaz nunca muestra ni pide un ID.
 */
export async function listIncidentRe20Participants(access: IncidentAccess, worksiteId: string) {
  requireAccess(access, "prevention:incidents:view", worksiteId)
  const ids = await getUserIdsWithPermissionForWorksite("prevention:incidents:view", worksiteId)
  if (ids.length === 0) return []
  return db.select({ id: users.id, name: users.name, position: workers.position }).from(users)
    .leftJoin(workers, eq(workers.id, users.workerId))
    .where(and(inArray(users.id, ids), eq(users.isActive, true))).orderBy(asc(users.name))
}

/* ── RE-20: Módulo de Investigación y Auto-acreditación PDTP ─────────────── */

/**
 * Prólogo común del expediente RE-20. El cierre exigió investigación completa y
 * CAPA cerradas; permitir escrituras posteriores corrompería el expediente que
 * sustentó el cierre (y re-dispararía acreditaciones PDTP), sin transición de
 * reapertura que lo audite.
 */
async function getInvestigableIncident(incidentId: string, access: IncidentAccess, client: IncidentClient = db) {
  // Con `client = tx` la comprobación de "no cerrado" queda dentro de la misma
  // unidad de trabajo que la escritura y bloquea la fila: sin eso, cerrar el
  // incidente entre esta lectura y el insert dejaba entrar una declaración o
  // difusión sobre el expediente que ya había sustentado el cierre.
  const [incident] = await client.select().from(preventionIncidents)
    .where(eq(preventionIncidents.id, incidentId)).for("update").limit(1)
  if (!incident) throw new Error("Incidente no encontrado.")
  requireAccess(access, "prevention:incidents:investigate", incident.worksiteId)
  if (incident.status === "closed") throw new Error("El incidente está cerrado y su expediente de investigación es inmutable.")
  return incident
}

function policyForSnapshot(version: number, policy: Record<string, number> | null | undefined): Re20SlaPolicy {
  return {
    version,
    preliminaryHours: policy?.preliminaryHours ?? DEFAULT_RE20_SLA_POLICY.preliminaryHours,
    witnessStatementsHours: policy?.witnessStatementsHours ?? DEFAULT_RE20_SLA_POLICY.witnessStatementsHours,
    injuredInterviewHours: policy?.injuredInterviewHours ?? DEFAULT_RE20_SLA_POLICY.injuredInterviewHours,
    definitiveHours: policy?.definitiveHours ?? DEFAULT_RE20_SLA_POLICY.definitiveHours,
    diffusionHours: policy?.diffusionHours ?? DEFAULT_RE20_SLA_POLICY.diffusionHours,
    followupDays: policy?.followupDays ?? DEFAULT_RE20_SLA_POLICY.followupDays,
  }
}

export async function getPreventionIncidentRe20Workspace(args: { incidentId: string; access: IncidentAccess; includeInactiveOptions?: boolean }) {
  requireAccess(args.access, "prevention:incidents:view")
  const [incident] = await db.select().from(preventionIncidents)
    .where(and(eq(preventionIncidents.id, args.incidentId), scopeCondition(args.access.scope)))
    .limit(1)
  if (!incident) return null
  const [workspace] = await db.select().from(preventionIncidentRe20Workspaces)
    .where(eq(preventionIncidentRe20Workspaces.incidentId, incident.id)).limit(1)
  const [globalPolicy] = await db.select().from(preventionIncidentRe20Policy)
    .where(eq(preventionIncidentRe20Policy.id, "default")).limit(1)
  // El caso no ofrece valores heredados (`legacy_*`) ni inactivos: sólo la administración del catálogo los ve.
  const options = await db.select().from(preventionIncidentClassificationCatalog)
    .where(args.includeInactiveOptions
      ? sql`true`
      : and(
        eq(preventionIncidentClassificationCatalog.isActive, true),
        not(like(preventionIncidentClassificationCatalog.category, "legacy\\_%")),
      ))
    .orderBy(
      asc(preventionIncidentClassificationCatalog.category),
      asc(preventionIncidentClassificationCatalog.sortOrder),
      asc(preventionIncidentClassificationCatalog.name),
    )
  const [reviews, statements] = await Promise.all([
    db.select().from(preventionIncidentRe20QualityReviews)
      .where(eq(preventionIncidentRe20QualityReviews.incidentId, incident.id))
      .orderBy(desc(preventionIncidentRe20QualityReviews.reviewedAt)),
    db.select({ id: preventionIncidentStatements.id, kind: preventionIncidentStatements.kind, createdAt: preventionIncidentStatements.createdAt })
      .from(preventionIncidentStatements).where(eq(preventionIncidentStatements.incidentId, incident.id))
      .orderBy(asc(preventionIncidentStatements.createdAt)),
  ])
  const policy = workspace
    ? policyForSnapshot(workspace.policyVersion, workspace.policySnapshot as Record<string, number>)
    : policyForSnapshot(globalPolicy?.version ?? 1, globalPolicy?.policy as Record<string, number> | undefined)
  return {
    incident,
    workspace: workspace ? {
      id: workspace.id,
      version: workspace.version,
      data: normalizedWorkspaceData(workspace.data),
      policyVersion: workspace.policyVersion,
      policySnapshot: workspace.policySnapshot,
      createdAt: workspace.createdAt,
      updatedByUserId: workspace.updatedByUserId,
      updatedAt: workspace.updatedAt,
    } : null,
    policy,
    options: options.length ? options : RE20_CLASSIFICATION_OPTIONS.map((option) => ({ ...option })),
    qualityReviews: reviews,
    statements,
  }
}

export async function getPreventionIncidentRe20SensitivePayload(args: {
  incidentId: string
  purpose: string
  access: IncidentAccess
}) {
  const purpose = args.purpose.trim()
  const [incident] = await db.select({ worksiteId: preventionIncidents.worksiteId }).from(preventionIncidents)
    .where(and(eq(preventionIncidents.id, args.incidentId), scopeCondition(args.access.scope))).limit(1)
  if (!incident) throw new Error("Incidente no encontrado o fuera de alcance.")
  if (purpose.length < 3 || purpose.length > 300 || !hasPermission(args.access.permissions, "prevention:incidents:view_sensitive")) {
    await auditIncidentSensitiveAccess({
      access: args.access, incidentId: args.incidentId, worksiteId: incident.worksiteId,
      purpose: purpose || "sin propósito", outcome: "denied", reasonCode: "permission_or_purpose",
    })
    throw new Error("No tienes autorización para ver la información sensible del RE-20.")
  }
  const [workspace] = await db.select().from(preventionIncidentRe20Workspaces)
    .where(eq(preventionIncidentRe20Workspaces.incidentId, args.incidentId)).limit(1)
  const statementRows = await db.select().from(preventionIncidentStatements)
    .where(eq(preventionIncidentStatements.incidentId, args.incidentId)).orderBy(asc(preventionIncidentStatements.createdAt))
  if (statementRows.some((row) => !row.encryptedPayload || !row.encryptedIv || !row.encryptedAuthTag || !row.encryptedKeyVersion)) {
    throw new Error("Hay declaraciones históricas pendientes de cifrado; el acceso reservado RE-20 se habilitará después de completar la migración verificada.")
  }
  const payload = workspace?.encryptedSensitivePayload && workspace.sensitiveIv && workspace.sensitiveAuthTag && workspace.sensitiveKeyVersion
    ? decryptPreventionPayload<Record<string, unknown>>({
      encryptedPayload: workspace.encryptedSensitivePayload,
      iv: workspace.sensitiveIv,
      authTag: workspace.sensitiveAuthTag,
      keyVersion: workspace.sensitiveKeyVersion,
    }, `incident-re20:${args.incidentId}`)
    : { declarations: [], injuredInterview: {}, injuryClinical: {}, diat: { form: {}, status: "draft" } }
  const historicalStatements = statementRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    createdAt: row.createdAt,
    ...(row.encryptedPayload && row.encryptedIv && row.encryptedAuthTag && row.encryptedKeyVersion
      ? decryptPreventionPayload<{ name: string; role: string | null; statement: string }>({
        encryptedPayload: row.encryptedPayload,
        iv: row.encryptedIv,
        authTag: row.encryptedAuthTag,
        keyVersion: row.encryptedKeyVersion,
      }, `incident-statement:${row.id}`)
      : {}),
  }))
  await auditIncidentSensitiveAccess({ access: args.access, incidentId: args.incidentId, worksiteId: incident.worksiteId, purpose, outcome: "granted" })
  return { ...payload, historicalStatements }
}

/** Datos del expediente normalizados al esquema vigente (lo anterior queda en `legacy`); si no parsean, lo guardado tal cual. */
function normalizedWorkspaceData(raw: unknown): Record<string, unknown> {
  const parsed = re20PublicDataSchema.safeParse(raw)
  return parsed.success ? (parsed.data as unknown as Record<string, unknown>) : ((raw ?? {}) as Record<string, unknown>)
}

type IncidentRow = typeof preventionIncidents.$inferSelect

const SERIOUS_SEVERITIES = new Set(["serious", "fatal"])
function incidentIsFatalOrSerious(incident: IncidentRow) {
  return incident.isFatalOrSerious || SERIOUS_SEVERITIES.has(incident.actualSeverity)
}

/** Tareas del protocolo que aplican a este evento (PASO A PASO!N7). */
function applicableTaskIds(incident: IncidentRow, data: Re20PublicData) {
  return new Set(re20ApplicableTaskIds(incident.eventType, {
    nearMissPotential: data.nearMiss.potential ?? incident.potentialSeverity,
    isFatalOrSerious: incidentIsFatalOrSerious(incident),
  }))
}

/** El árbol es obligatorio salvo cuasi accidente cuyo potencial (reportado o del expediente) no sea «Grave o fatal». */
function treeIsRequired(incident: IncidentRow, data: Re20PublicData) {
  return [data.nearMiss.potential, incident.potentialSeverity]
    .some((potential) => re20TreeRequired(incident.eventType, { nearMissPotential: potential }))
}

/**
 * Qué falta para dar por completado el informe definitivo (INV.DEF.ACC): árbol completo cuando es obligatorio,
 * conclusión, cada causa raíz con ≥1 medida (B146) y cada medida con responsable y verificador (B112).
 * El verificador distinto del responsable lo impone el esquema en cada guardado.
 */
export function re20DefinitiveCompletionIssues(incident: IncidentRow, data: Re20PublicData): string[] {
  const issues: string[] = []
  const tree = data.causalTree
  const required = treeIsRequired(incident, data)
  if (required) issues.push(...re20CausalGraphCompletenessIssues(tree))
  if ((data.definitive.conclusion?.trim().length ?? 0) < 10) issues.push("Falta la conclusión del equipo investigador.")
  const eventIds = new Set(tree.events.map((event) => event.id))
  for (const rootId of deriveRe20RootCauses(tree)) {
    if (!data.measures.some((measure) => measure.rootCauseId === rootId)) {
      issues.push(`La causa raíz ${rootId} no tiene ninguna medida asociada.`)
    }
  }
  data.measures.forEach((measure, index) => {
    const label = `La medida ${index + 1}`
    if (measure.rootCauseId && !eventIds.has(measure.rootCauseId)) issues.push(`${label} apunta a un hecho inexistente (${measure.rootCauseId}).`)
    if (!measure.responsibleUserId) issues.push(`${label} no tiene responsable.`)
    if (!measure.verifierUserId) issues.push(`${label} no tiene verificador.`)
  })
  return [...new Set(issues)]
}

async function assertRe20CapaLinks(tx: IncidentClient, incidentId: string, measures: Re20Measure[]) {
  const capaIds = [...new Set(measures.map((measure) => measure.capaId).filter((id): id is string => Boolean(id)))]
  if (capaIds.length === 0) return
  const rows = await tx.select({ id: preventionCapaActions.id }).from(preventionCapaActions).where(and(
    inArray(preventionCapaActions.id, capaIds),
    eq(preventionCapaActions.sourceType, "incident"),
    eq(preventionCapaActions.sourceId, incidentId),
  ))
  if (rows.length !== capaIds.length) throw new Error("Una medida apunta a una CAPA que no existe o no pertenece a este incidente.")
}

const APPROVING_DECISIONS = ["approved", "approved_with_observations"] as const
const isApproval = (decision: string) => (APPROVING_DECISIONS as readonly string[]).includes(decision)

async function syncRe20Milestones(args: {
  incident: IncidentRow
  data: Re20PublicData
  sensitive?: z.infer<typeof re20SensitivePayloadSchema>
  userId: string
}) {
  const { incident, data, sensitive, userId } = args
  const completed = (id: string) => data.tasks.find((task) => task.id === id)?.status === "completed"
  if (completed("preliminary_report")) {
    const at = data.tasks.find((task) => task.id === "preliminary_report")?.completedAt ?? nowIso()
    await onIncidentPreliminaryReported({ incidentId: incident.id, worksiteId: incident.worksiteId, reportedAt: at, userId })
  }
  if ((sensitive?.declarations.length ?? 0) > 0) {
    const at = sensitive?.declarations.find((declaration) => declaration.signedAt)?.signedAt ?? nowIso()
    await onIncidentStatementRecorded({ incidentId: incident.id, worksiteId: incident.worksiteId, recordedAt: at, userId })
  }
  // El informe definitivo se acredita al aprobarse la revisión de calidad (RE-20-13, «aprobado» o «aprobado
  // con observaciones»), no al marcar la tarea. La difusión y el seguimiento se acreditan al registrarse en sus
  // tablas canónicas (`publishOnePageDiffusion`, `recordBiweeklyFollowup`).
}

export async function savePreventionIncidentRe20Workspace(args: { input: unknown; access: IncidentAccess }) {
  requireAccess(args.access, "prevention:incidents:investigate")
  const input = re20WorkspaceSaveSchema.parse(args.input)
  if (input.sensitive && !hasPermission(args.access.permissions, "prevention:incidents:view_sensitive")) {
    const [target] = await db.select({ worksiteId: preventionIncidents.worksiteId }).from(preventionIncidents)
      .where(eq(preventionIncidents.id, input.incidentId)).limit(1)
    if (target) await auditIncidentSensitiveAccess({
      access: args.access, incidentId: input.incidentId, worksiteId: target.worksiteId,
      purpose: input.sensitive.purpose, outcome: "denied", reasonCode: "permission", action: "update",
    })
    throw new Error("No tienes autorización para guardar información sensible del RE-20.")
  }
  const result = await db.transaction(async (tx) => {
    const incident = await getInvestigableIncident(input.incidentId, args.access, tx)
    const [priorMutation] = await tx.select().from(preventionIncidentRe20Mutations)
      .where(and(eq(preventionIncidentRe20Mutations.incidentId, incident.id), eq(preventionIncidentRe20Mutations.mutationId, input.mutationId))).limit(1)
    if (priorMutation) {
      const [workspace] = await tx.select().from(preventionIncidentRe20Workspaces)
        .where(eq(preventionIncidentRe20Workspaces.incidentId, incident.id)).limit(1)
      if (!workspace) throw new Error("El guardado idempotente no tiene un expediente RE-20 asociado.")
      return { incident, workspace, data: null as Re20PublicData | null, idempotentReplay: true as const }
    }
    const [existing] = await tx.select().from(preventionIncidentRe20Workspaces)
      .where(eq(preventionIncidentRe20Workspaces.incidentId, incident.id)).limit(1)
    if ((existing?.version ?? 0) !== input.expectedVersion) {
      throw new Error("Otra persona modificó el expediente RE-20. Conserva tu borrador y recarga para resolver el conflicto.")
    }

    // ── Reglas del servidor ────────────────────────────────────────────────
    const stored = existing ? normalizedWorkspaceData(existing.data) as Partial<Re20PublicData> : {}
    const storedMethodology = (existing?.data as { methodology?: string } | undefined)?.methodology
    if (input.data.methodology !== "causal_tree" && input.data.methodology !== storedMethodology) {
      throw new Error("La metodología del RE-20 es el árbol de causas: «5 porqués» y «otra» sólo se conservan en expedientes que ya las usaban.")
    }
    const data: Re20PublicData = {
      ...input.data,
      // Las copias anteriores se conservan aunque el cliente no las reenvíe.
      ...(stored.legacy || input.data.legacy ? { legacy: { ...(stored.legacy ?? {}), ...(input.data.legacy ?? {}) } } : {}),
      // La vinculación con la CAPA la fija `createCapaFromRe20Measure`: un cliente que no la conoce no la borra.
      measures: input.data.measures.map((measure) => ({
        ...measure,
        capaId: measure.capaId ?? stored.measures?.find((item) => item.id === measure.id)?.capaId ?? null,
      })),
    }
    const required = treeIsRequired(incident, data)
    // Cuasi accidente de potencial grave o fatal: árbol obligatorio (Reporte Cuasi Accidente!D24), no se desmarca.
    if (required && incident.eventType === "dangerous_incident") {
      data.nearMiss = { ...data.nearMiss, seriousOrFatalPotential: true, do36TreeRequired: true }
    }
    await assertRe20CapaLinks(tx, incident.id, data.measures)
    const applicable = applicableTaskIds(incident, data)
    const alreadyCompleted = new Set((stored.tasks ?? []).filter((task) => task.status === "completed").map((task) => task.id))
    for (const task of data.tasks) {
      if (task.status === "completed" && !applicable.has(task.id) && !alreadyCompleted.has(task.id)) {
        const label = RE20_TASK_DEFINITIONS.find((definition) => definition.id === task.id)?.label ?? task.label
        throw new Error(`La tarea «${label}» no aplica a este tipo de evento: no puede marcarse como completada.`)
      }
    }
    if (data.tasks.some((task) => task.id === "definitive_report" && task.status === "completed")) {
      const issues = re20DefinitiveCompletionIssues(incident, data)
      if (issues.length > 0) throw new Error(`No se puede completar el informe definitivo: ${issues.join(" ")}`)
    }

    const [globalPolicy] = await tx.select().from(preventionIncidentRe20Policy)
      .where(eq(preventionIncidentRe20Policy.id, "default")).limit(1)
    const policy = existing
      ? policyForSnapshot(existing.policyVersion, existing.policySnapshot as Record<string, number>)
      : policyForSnapshot(globalPolicy?.version ?? 1, globalPolicy?.policy as Record<string, number> | undefined)
    const now = nowIso()
    const encrypted = input.sensitive
      ? encryptPreventionPayload({ ...input.sensitive, purpose: undefined }, `incident-re20:${incident.id}`)
      : null
    const nextVersion = (existing?.version ?? 0) + 1
    const values = {
      version: nextVersion,
      data,
      policyVersion: policy.version,
      policySnapshot: { ...policy },
      ...(encrypted ? {
        encryptedSensitivePayload: encrypted.encryptedPayload,
        sensitiveIv: encrypted.iv,
        sensitiveAuthTag: encrypted.authTag,
        sensitiveKeyVersion: encrypted.keyVersion,
      } : {}),
      updatedByUserId: args.access.ctx.userId,
      updatedAt: now,
    }
    const [workspace] = existing
      ? await tx.update(preventionIncidentRe20Workspaces).set(values)
        .where(and(eq(preventionIncidentRe20Workspaces.id, existing.id), eq(preventionIncidentRe20Workspaces.version, input.expectedVersion))).returning()
      : await tx.insert(preventionIncidentRe20Workspaces).values({
        id: `re20-${nanoid()}`,
        incidentId: incident.id,
        ...values,
        createdByUserId: args.access.ctx.userId,
        createdAt: now,
      }).returning()
    if (!workspace) throw new Error("Otra persona modificó el expediente RE-20. Recarga para resolver el conflicto.")
    await tx.insert(preventionIncidentRe20Mutations).values({
      id: `re20m-${nanoid()}`,
      incidentId: incident.id,
      mutationId: input.mutationId,
      workspaceVersion: nextVersion,
      createdAt: now,
    })
    // Trabajar el expediente es iniciar la investigación: la «Investigación guiada» que se retiró hacía
    // esta transición, y sin ella ningún control llevaba el caso de medidas inmediatas a investigación.
    let toStatus = incident.status
    if (incident.status === "immediate_measures") {
      await tx.update(preventionIncidents).set({
        status: "under_investigation",
        version: sql`${preventionIncidents.version} + 1`,
        updatedAt: now,
      }).where(eq(preventionIncidents.id, incident.id))
      toStatus = "under_investigation"
    }
    await appendHistory(tx, {
      incidentId: incident.id,
      changeType: "investigation",
      actorUserId: args.access.ctx.userId,
      ...(toStatus !== incident.status ? { fromStatus: incident.status, toStatus } : {}),
      reason: "Expediente RE-20 actualizado",
      changeSet: { re20WorkspaceVersion: nextVersion, policyVersion: policy.version },
      createdAt: now,
    })
    await recordModuleHistory(tx, {
      module: "prevention_incident",
      entityType: "re20_workspace",
      entityId: incident.id,
      worksiteId: incident.worksiteId,
      changeType: "updated",
      reason: "Expediente RE-20 actualizado",
      beforeState: existing ? { version: existing.version } : undefined,
      afterState: { version: nextVersion, policyVersion: policy.version },
      actorUserId: args.access.ctx.userId,
    })
    if (input.sensitive) await auditIncidentSensitiveAccess({
      access: args.access, incidentId: incident.id, worksiteId: incident.worksiteId,
      purpose: input.sensitive.purpose, outcome: "granted", action: "update", client: tx,
    })
    return { incident, workspace, data: data as Re20PublicData | null, idempotentReplay: false as const }
  })
  // Un reintento (cola offline) no vuelve a acreditar: el primer guardado ya lo hizo.
  if (!result.idempotentReplay && result.data) {
    await syncRe20Milestones({ incident: result.incident, data: result.data, sensitive: input.sensitive, userId: args.access.ctx.userId })
  }
  const { encryptedSensitivePayload: _ciphertext, sensitiveIv: _iv, sensitiveAuthTag: _tag, sensitiveKeyVersion: _keyVersion, ...safeWorkspace } = result.workspace
  return { incidentId: result.incident.id, workspace: safeWorkspace, idempotentReplay: result.idempotentReplay }
}

/** Rol con el que firma la revisión: `jefa_chome` si lo tiene (la impresión muestra «en reemplazo» si no es ese). */
function reviewerRoleLabel(roles: readonly string[] | undefined) {
  if (roles?.includes("jefa_chome")) return "jefa_chome"
  return roles?.join(", ") || "Revisor de calidad RE-20"
}

const REVIEW_HISTORY_REASON: Record<string, string> = {
  approved: "Revisión de calidad RE-20 aprobada",
  approved_with_observations: "Revisión de calidad RE-20 aprobada con observaciones",
  changes_required: "Correcciones RE-20 solicitadas",
}

export async function reviewPreventionIncidentRe20Quality(args: { input: unknown; access: IncidentAccess }) {
  requireAccess(args.access, "prevention:incidents:review_quality")
  const input = re20QualityReviewSchema.parse(args.input)
  const ids = input.criteria.map((criterion) => criterion.id)
  if (new Set(ids).size !== RE20_QUALITY_CRITERIA.length || RE20_QUALITY_CRITERIA.some((criterion) => !ids.includes(criterion.id))) {
    throw new Error("La revisión debe contener exactamente los 13 criterios RE-20.")
  }
  // La decisión la manda quien revisa (Clasificación!AI); el servidor sólo comprueba que sea coherente con los criterios.
  if (input.decision === "approved" && input.criteria.some((criterion) => criterion.result !== "meets")) {
    throw new Error("Para aprobar, los 13 criterios deben cumplir. Usa «Aprobado con observaciones» si hay criterios parciales.")
  }
  if (input.decision === "approved_with_observations" && input.criteria.some((criterion) => criterion.result === "does_not_meet")) {
    throw new Error("No se puede aprobar con observaciones un criterio que «No cumple»: solicita correcciones.")
  }
  if (input.decision !== "approved" && !input.observation?.trim()) {
    throw new Error("Registra la observación final de la revisión: es obligatoria salvo en una aprobación sin reparos.")
  }
  const result = await db.transaction(async (tx) => {
    const incident = await getInvestigableIncident(input.incidentId, args.access, tx)
    requireAccess(args.access, "prevention:incidents:review_quality", incident.worksiteId)
    const [workspace] = await tx.select().from(preventionIncidentRe20Workspaces)
      .where(eq(preventionIncidentRe20Workspaces.incidentId, incident.id)).limit(1)
    if (!workspace || workspace.version !== input.expectedWorkspaceVersion) {
      throw new Error("El expediente cambió desde que se abrió la revisión. Recarga y vuelve a revisar.")
    }
    const investigators = (workspace.data as { team?: Array<{ userId?: string }> }).team ?? []
    if (investigators.some((member) => member.userId === args.access.ctx.userId) || workspace.updatedByUserId === args.access.ctx.userId) {
      throw new Error("Quien investigó o modificó el expediente no puede aprobar su propia revisión de calidad.")
    }
    const now = nowIso()
    const [review] = await tx.insert(preventionIncidentRe20QualityReviews).values({
      id: `re20review-${nanoid()}`,
      incidentId: incident.id,
      workspaceVersion: workspace.version,
      criteria: input.criteria,
      decision: input.decision,
      observation: input.observation?.trim() || null,
      reviewerRole: reviewerRoleLabel(args.access.roles),
      reviewerUserId: args.access.ctx.userId,
      reviewedAt: now,
    }).returning()
    if (!review) throw new Error("No se pudo registrar la revisión de calidad RE-20.")
    // Las dos aprobaciones dan por terminada la investigación definitiva: sin esto, CAPA, cierre y reinicio
    // quedan bloqueados porque ya no existe otro formulario que la complete.
    if (isApproval(input.decision)) {
      await completeIncidentInvestigationFromRe20(tx, {
        incident,
        data: re20PublicDataSchema.parse(workspace.data),
        userId: args.access.ctx.userId,
        now,
      })
    }
    // «Requiere corrección» devuelve el informe al equipo: reabre la tarea y sube la versión en la misma
    // transacción, así un guardado offline con la versión anterior choca y no pisa la corrección.
    // `updatedByUserId` no cambia: quien pide correcciones no pasa a ser autor del expediente.
    // Una aprobación, en cambio, cierra la tarea de revisión: sin esto la etapa 5 quedaba «en curso».
    {
      const stored = workspace.data as { tasks?: Array<Record<string, unknown>> }
      const tasks = Array.isArray(stored.tasks) ? stored.tasks : []
      const taskId = input.decision === "changes_required" ? "definitive_report" : "quality_review"
      const patch = input.decision === "changes_required"
        ? { status: "in_progress", completedAt: null }
        : { status: "completed", completedAt: now, note: input.observation ?? null }
      const definition = RE20_TASK_DEFINITIONS.find((task) => task.id === taskId)
      const nextTasks = tasks.some((task) => task.id === taskId)
        ? tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task)
        : [...tasks, { id: taskId, sheet: definition?.sheet ?? "RE-20", label: definition?.label ?? taskId, ...patch }]
      const [bumped] = await tx.update(preventionIncidentRe20Workspaces).set({
        data: { ...workspace.data, tasks: nextTasks },
        version: workspace.version + 1,
        updatedAt: now,
      }).where(and(eq(preventionIncidentRe20Workspaces.id, workspace.id), eq(preventionIncidentRe20Workspaces.version, workspace.version))).returning({ id: preventionIncidentRe20Workspaces.id })
      if (!bumped) throw new Error("El expediente cambió desde que se abrió la revisión. Recarga y vuelve a revisar.")
    }
    await appendHistory(tx, {
      incidentId: incident.id, changeType: "investigation", actorUserId: args.access.ctx.userId,
      reason: REVIEW_HISTORY_REASON[input.decision],
      changeSet: { qualityReviewId: review.id, workspaceVersion: workspace.version, decision: input.decision }, createdAt: now,
    })
    await recordModuleHistory(tx, {
      module: "prevention_incident", entityType: "re20_quality_review", entityId: review.id,
      worksiteId: incident.worksiteId, changeType: input.decision,
      reason: input.observation ?? "Revisión de calidad RE-20", afterState: { incidentId: incident.id, workspaceVersion: workspace.version },
      actorUserId: args.access.ctx.userId,
    })
    return { review, worksiteId: incident.worksiteId }
  })
  if (isApproval(result.review.decision)) {
    await onIncidentInvestigationCompleted({
      incidentId: result.review.incidentId,
      worksiteId: result.worksiteId,
      completedAt: result.review.reviewedAt,
      userId: args.access.ctx.userId,
    })
  }
  return result.review
}

async function completeIncidentInvestigationFromRe20(tx: IncidentClient, args: {
  incident: IncidentRow
  data: Re20PublicData
  userId: string
  now: string
}) {
  const { data, incident } = args
  if (data.tasks.find((task) => task.id === "definitive_report")?.status !== "completed") {
    throw new Error("Marca el informe definitivo como completado antes de aprobar la revisión de calidad.")
  }
  const conclusion = data.definitive.conclusion?.trim() ?? ""
  if (conclusion.length < 10) throw new Error("El informe definitivo necesita una conclusión del equipo antes de aprobarse.")
  const issues = re20DefinitiveCompletionIssues(incident, data)
  if (issues.length > 0) throw new Error(`El informe definitivo está incompleto: ${issues.join(" ")}`)
  const describe = (id: string) => data.causalTree.events.find((event) => event.id === id)?.description.trim() ?? ""
  const rootCauses = deriveRe20RootCauses(data.causalTree).map(describe).filter(Boolean)
  const finalFactId = data.causalTree.events.find((event) => event.id === "H1")?.id ?? data.causalTree.events[0]?.id
  const immediateCauses = data.causalTree.relations
    .filter((relation) => relation.to === finalFactId)
    .map((relation) => describe(relation.from))
    .filter(Boolean)

  const [existing] = await tx.select().from(preventionIncidentInvestigations)
    .where(eq(preventionIncidentInvestigations.incidentId, incident.id)).limit(1)
  // Las marcas MIPER, procedimiento y capacitación siguen siendo compuertas:
  // la aprobación no puede saltarse una actualización que quedó comprometida.
  if (existing?.miperUpdateRequired && !existing.miperUpdatedAt) throw new Error("La investigación exige actualizar la MIPER antes de completarse.")
  if (existing?.procedureUpdateRequired && !existing.procedureUpdatedAt) throw new Error("La investigación exige actualizar el procedimiento antes de completarse.")
  if (existing?.trainingRequired && !existing.trainingCompletedAt) throw new Error("La investigación exige registrar la capacitación antes de completarse.")

  const values = {
    status: "completed",
    methodology: "Árbol de causas",
    team: data.team.filter((member) => member.userId).map((member) => ({ userId: member.userId, role: member.role })),
    immediateCauses,
    basicCauses: rootCauses,
    conclusions: conclusion,
    completedByUserId: existing?.completedAt ? existing.completedByUserId : args.userId,
    completedAt: existing?.completedAt ?? args.now,
    definitiveReportSentAt: existing?.definitiveReportSentAt ?? args.now,
    updatedAt: args.now,
  }
  if (existing) {
    await tx.update(preventionIncidentInvestigations).set({
      ...values,
      version: sql`${preventionIncidentInvestigations.version} + 1`,
    }).where(eq(preventionIncidentInvestigations.id, existing.id))
  } else {
    await tx.insert(preventionIncidentInvestigations).values({
      id: `inci-${nanoid()}`,
      incidentId: incident.id,
      ...values,
      startedByUserId: args.userId,
      startedAt: args.now,
      version: 1,
    })
  }
}

/** Medida → CAPA. Crea la acción con los datos de la medida y la vincula (`capaId`) con la misma versión optimista del expediente. */
const capaFromMeasureSchema = z.object({
  incidentId: z.string().min(1),
  measureId: z.string().trim().min(1).max(80),
  expectedWorkspaceVersion: z.number().int().positive(),
})

const CAPA_PRIORITY_BY_LABEL: Record<string, CapaInput["priority"]> = { alta: "high", media: "medium", baja: "low" }

export async function createCapaFromRe20Measure(args: { input: unknown; access: IncidentAccess }) {
  requireAccess(args.access, "prevention:incidents:investigate")
  requireAccess(args.access, "prevention:capa:manage")
  const input = capaFromMeasureSchema.parse(args.input)
  return db.transaction(async (tx) => {
    const incident = await getInvestigableIncident(input.incidentId, args.access, tx)
    const [workspace] = await tx.select().from(preventionIncidentRe20Workspaces)
      .where(eq(preventionIncidentRe20Workspaces.incidentId, incident.id)).limit(1)
    if (!workspace || workspace.version !== input.expectedWorkspaceVersion) {
      throw new Error("Otra persona modificó el expediente RE-20. Recarga para resolver el conflicto.")
    }
    const data = re20PublicDataSchema.parse(workspace.data)
    const measure = data.measures.find((item) => item.id === input.measureId)
    if (!measure) throw new Error("La medida no existe en el expediente RE-20.")
    if (measure.capaId) throw new Error("La medida ya tiene una CAPA vinculada.")
    if (measure.description.trim().length < 3) throw new Error("Describe la medida antes de crear su CAPA.")
    if (!measure.dueAt) throw new Error("La medida necesita una fecha compromiso para crear su CAPA.")
    const rootCause = measure.rootCauseId
      ? data.causalTree.events.find((event) => event.id === measure.rootCauseId)?.description.trim() || null
      : null
    const now = nowIso()
    const created = await createIncidentCapaInTx(tx, {
      incident,
      userId: args.access.ctx.userId,
      input: capaSchema.parse({
        incidentId: incident.id,
        expectedVersion: incident.version,
        finding: rootCause ?? measure.description,
        rootCause,
        actionDescription: measure.description,
        responsibleUserId: measure.responsibleUserId ?? null,
        responsibleRole: measure.responsibleRole ?? null,
        priority: CAPA_PRIORITY_BY_LABEL[(measure.priority ?? "").trim().toLowerCase()] ?? "medium",
        targetDate: todayInChile(new Date(measure.dueAt)),
        evidenceRequired: true,
        sourceItemId: `re20-measure:${measure.id}`,
      }),
    })
    const linked = data.measures.map((item) => item.id === measure.id ? { ...item, capaId: created.capa.id } : item)
    const [bumped] = await tx.update(preventionIncidentRe20Workspaces).set({
      data: { ...data, measures: linked },
      version: workspace.version + 1,
      updatedByUserId: args.access.ctx.userId,
      updatedAt: now,
    }).where(and(eq(preventionIncidentRe20Workspaces.id, workspace.id), eq(preventionIncidentRe20Workspaces.version, workspace.version))).returning({ version: preventionIncidentRe20Workspaces.version })
    if (!bumped) throw new Error("Otra persona modificó el expediente RE-20. Recarga para resolver el conflicto.")
    return { capa: created.capa, incident: created.incident, workspaceVersion: bumped.version, measureId: measure.id }
  })
}

const re20PolicyInputSchema = z.object({
  preliminaryHours: z.number().int().min(1).max(168),
  witnessStatementsHours: z.number().int().min(1).max(168),
  injuredInterviewHours: z.number().int().min(1).max(168),
  definitiveHours: z.number().int().min(1).max(720),
  diffusionHours: z.number().int().min(1).max(168),
  followupDays: z.number().int().min(1).max(365),
})

export async function savePreventionIncidentRe20Policy(args: { input: unknown; access: IncidentAccess }) {
  requireAccess(args.access, "prevention:incidents:configure_re20")
  const policy = re20PolicyInputSchema.parse(args.input)
  const now = nowIso()
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(preventionIncidentRe20Policy)
      .where(eq(preventionIncidentRe20Policy.id, "default")).for("update").limit(1)
    const version = (current?.version ?? 0) + 1
    const values = { version, policy, updatedByUserId: args.access.ctx.userId, updatedAt: now }
    const [saved] = current
      ? await tx.update(preventionIncidentRe20Policy).set(values).where(eq(preventionIncidentRe20Policy.id, "default")).returning()
      : await tx.insert(preventionIncidentRe20Policy).values({ id: "default", ...values }).returning()
    if (!saved) throw new Error("No se pudo guardar la política SLA RE-20.")
    return policyForSnapshot(saved.version, saved.policy as Record<string, number>)
  })
}

const re20CatalogOptionSchema = z.object({
  category: z.string().trim().min(1).max(80).refine((category) => RE20_CLASSIFICATION_OPTIONS.some((option) => option.category === category), "Categoría RE-20 inválida."),
  code: z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Usa un código simple, sin espacios."),
  name: z.string().trim().min(1).max(240),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  parentCode: z.string().trim().max(40).nullable().optional(),
})

/** Gestiona valores del catálogo RE-20 con clave estable: se inactiva, nunca se borra. */
export async function savePreventionIncidentRe20CatalogOption(args: { input: unknown; access: IncidentAccess }) {
  requireAccess(args.access, "prevention:incidents:configure_re20")
  const input = re20CatalogOptionSchema.parse(args.input)
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(preventionIncidentClassificationCatalog)
      .where(and(
        eq(preventionIncidentClassificationCatalog.category, input.category),
        eq(preventionIncidentClassificationCatalog.code, input.code),
      )).for("update").limit(1)
    const option = current
      ? (await tx.update(preventionIncidentClassificationCatalog).set({
        name: input.name,
        isActive: input.isActive,
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.parentCode !== undefined ? { parentCode: input.parentCode } : {}),
      }).where(eq(preventionIncidentClassificationCatalog.id, current.id)).returning())[0]
      : (await tx.insert(preventionIncidentClassificationCatalog).values({
        id: `re20cat-${nanoid()}`,
        category: input.category,
        code: input.code,
        name: input.name,
        isActive: input.isActive,
        parentCode: input.parentCode ?? null,
        // Un valor nuevo va al final de su lista, como una fila nueva del libro.
        sortOrder: input.sortOrder ?? (await tx.select({ max: sql<number>`coalesce(max(${preventionIncidentClassificationCatalog.sortOrder}), 0)` })
          .from(preventionIncidentClassificationCatalog)
          .where(eq(preventionIncidentClassificationCatalog.category, input.category)))[0]!.max + 1,
      }).returning())[0]
    if (!option) throw new Error("No se pudo guardar el valor del catálogo RE-20.")
    await recordModuleHistory(tx, {
      module: "prevention_incident",
      entityType: "re20_classification_catalog",
      entityId: option.id,
      changeType: current ? "updated" : "created",
      reason: input.isActive ? "Opción de clasificación RE-20 activa" : "Opción de clasificación RE-20 inactiva",
      beforeState: current ? { category: current.category, code: current.code, name: current.name, isActive: current.isActive } : undefined,
      afterState: { category: option.category, code: option.code, name: option.name, isActive: option.isActive },
      actorUserId: args.access.ctx.userId,
    })
    return option
  })
}

export async function createPreliminaryReport(args: {
  incidentId: string
  preliminaryReportText: string
  access: IncidentAccess
}) {
  const input = re20TextSchemas.preliminary.parse(args)
  const now = new Date().toISOString()
  // `onConflictDoUpdate` sobre el único de `incidentId` en vez de leer-y-decidir:
  // dos personas registrando el informe preliminar (SLA de 3 h) leían ambas
  // "no existe investigación" y la segunda chocaba con el índice único, con un
  // error crudo de Postgres.
  const incident = await db.transaction(async (tx) => {
    const found = await getInvestigableIncident(args.incidentId, args.access, tx)
    await tx.insert(preventionIncidentInvestigations).values({
      id: `incinv-${nanoid()}`,
      incidentId: found.id,
      status: "in_progress",
      methodology: "5_whys",
      preliminaryReportText: input.preliminaryReportText,
      preliminaryReportAt: now,
      startedByUserId: args.access.ctx.userId,
      startedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: preventionIncidentInvestigations.incidentId,
      set: {
        preliminaryReportText: input.preliminaryReportText,
        preliminaryReportAt: now,
        updatedAt: now,
      },
    })
    return found
  })

  // Auto-acreditación PDTP: Actividades 68, 70 (preliminar ≤3h). Fuera de la
  // transacción, como el resto del archivo.
  await onIncidentPreliminaryReported({ incidentId: incident.id, worksiteId: incident.worksiteId, reportedAt: now, userId: args.access.ctx.userId })

  return { incidentId: incident.id, preliminaryReportAt: now }
}

export async function recordIncidentStatement(args: {
  incidentId: string
  kind: "involved" | "witness" | "cphs"
  purpose: string
  deponentName: string
  deponentRole?: string
  statementText: string
  access: IncidentAccess
}) {
  const input = re20TextSchemas.statement.parse(args)
  const now = new Date().toISOString()
  const { incident, created } = await db.transaction(async (tx) => {
    const found = await getInvestigableIncident(input.incidentId, args.access, tx)
    if (!hasPermission(args.access.permissions, "prevention:incidents:view_sensitive") || !scopeAllows(args.access.scope, found.worksiteId)) {
      await auditIncidentSensitiveAccess({
        access: args.access, incidentId: found.id, worksiteId: found.worksiteId, purpose: input.purpose,
        outcome: "denied", reasonCode: "permission_or_scope", action: "create", client: tx,
      })
      throw new Error("No tienes autorización para registrar una declaración reservada.")
    }
    const id = `incstmt-${nanoid()}`
    const encrypted = encryptPreventionPayload({
      name: input.deponentName,
      role: input.deponentRole ?? null,
      statement: input.statementText,
    }, `incident-statement:${id}`)
    const [row] = await tx.insert(preventionIncidentStatements).values({
      id,
      incidentId: found.id,
      kind: input.kind,
      deponentName: null,
      deponentRole: null,
      statementText: null,
      encryptedPayload: encrypted.encryptedPayload,
      encryptedIv: encrypted.iv,
      encryptedAuthTag: encrypted.authTag,
      encryptedKeyVersion: encrypted.keyVersion,
      signedAt: now,
      createdByUserId: args.access.ctx.userId,
      createdAt: now,
    }).returning()
    if (!row) throw new Error("No se pudo guardar la declaración cifrada.")
    await auditIncidentSensitiveAccess({
      access: args.access, incidentId: found.id, worksiteId: found.worksiteId, purpose: input.purpose,
      outcome: "granted", action: "create", client: tx,
    })
    return { incident: found, created: { id: row.id, kind: row.kind, signedAt: row.signedAt, createdAt: row.createdAt } }
  })

  // Auto-acreditación PDTP: Actividad 69 (declaración ≤24h)
  await onIncidentStatementRecorded({ incidentId: incident.id, worksiteId: incident.worksiteId, recordedAt: now, userId: args.access.ctx.userId })

  return created
}

/** Última revisión de calidad del expediente; la difusión sólo sale si esa revisión aprobó. */
async function latestRe20Review(client: IncidentClient, incidentId: string) {
  const [review] = await client.select().from(preventionIncidentRe20QualityReviews)
    .where(eq(preventionIncidentRe20QualityReviews.incidentId, incidentId))
    .orderBy(desc(preventionIncidentRe20QualityReviews.reviewedAt)).limit(1)
  return review ?? null
}

/** Tabla causa / medida / responsable / plazo / estatus del RE-20-06 (C16:L23), generada desde las medidas. */
async function buildDiffusionMeasuresTable(client: IncidentClient, data: Re20PublicData) {
  const responsibleIds = [...new Set(data.measures.map((measure) => measure.responsibleUserId).filter((id): id is string => Boolean(id)))]
  const names = new Map<string, string>()
  if (responsibleIds.length > 0) {
    const rows = await client.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, responsibleIds))
    for (const row of rows) names.set(row.id, row.name)
  }
  const describe = (id?: string | null) => id ? data.causalTree.events.find((event) => event.id === id)?.description.trim() ?? "" : ""
  return data.measures.filter((measure) => measure.description.trim()).map((measure) => ({
    rootCauseId: measure.rootCauseId ?? null,
    rootCause: describe(measure.rootCauseId),
    measure: measure.description.trim(),
    responsible: (measure.responsibleUserId ? names.get(measure.responsibleUserId) : null) ?? measure.responsibleRole ?? null,
    dueAt: measure.dueAt ?? null,
    status: measure.status ?? null,
  }))
}

const clip = (value: string, max: number) => value.length > max ? `${value.slice(0, max - 1)}…` : value

export async function publishOnePageDiffusion(args: {
  incidentId: string
  onePageSummary?: string
  rootCauseText?: string
  actionPlanSummary?: string
  learning?: string
  evidenceRef?: string
  access: IncidentAccess
}) {
  const input = re20TextSchemas.onePage.parse(args)
  const now = new Date().toISOString()
  const { incident, created } = await db.transaction(async (tx) => {
    const found = await getInvestigableIncident(input.incidentId, args.access, tx)
    // RE-20-13: la difusión va después de la aprobación (ya sea con o sin observaciones).
    const review = await latestRe20Review(tx, found.id)
    if (!review || !isApproval(review.decision)) {
      throw new Error("La difusión exige la revisión de calidad RE-20 aprobada (RE-20-13).")
    }
    const [workspace] = await tx.select().from(preventionIncidentRe20Workspaces)
      .where(eq(preventionIncidentRe20Workspaces.incidentId, found.id)).limit(1)
    const data = workspace ? re20PublicDataSchema.parse(workspace.data) : null
    const measuresTable = data ? await buildDiffusionMeasuresTable(tx, data) : []
    const rootCauses = data
      ? deriveRe20RootCauses(data.causalTree).map((id) => data.causalTree.events.find((event) => event.id === id)?.description.trim()).filter(Boolean)
      : []
    const onePageSummary = input.onePageSummary
      ?? clip(data?.definitive.reconstruction?.trim() || data?.preliminary.eventDescription?.trim() || found.initialNarrative, 5000)
    const rootCauseText = input.rootCauseText ?? clip(rootCauses.join("; "), 5000)
    const actionPlanSummary = input.actionPlanSummary ?? clip(measuresTable.map((row) => row.measure).join("; "), 5000)
    if (onePageSummary.length < 10 || rootCauseText.length < 10 || actionPlanSummary.length < 10) {
      throw new Error("El ONE PAGE necesita el resumen, las causas raíz y el plan de acción: completa el árbol y las medidas del expediente.")
    }
    const [row] = await tx.insert(preventionIncidentDiffusion).values({
      id: `incdif-${nanoid()}`,
      incidentId: found.id,
      onePageSummary,
      rootCauseText,
      actionPlanSummary,
      evidenceRef: input.evidenceRef ?? null,
      measuresTable,
      learning: input.learning ?? data?.definitive.closure.learningDetail?.trim() ?? null,
      workspaceVersion: workspace?.version ?? null,
      diffusedAt: now,
      createdByUserId: args.access.ctx.userId,
      createdAt: now,
    }).returning()
    return { incident: found, created: row }
  })

  // Auto-acreditación PDTP: Actividad 78 (ONE PAGE ≤24h)
  await onIncidentOnePageDiffused({ incidentId: incident.id, worksiteId: incident.worksiteId, diffusedAt: now, userId: args.access.ctx.userId })

  return created
}

export async function recordBiweeklyFollowup(args: {
  incidentId: string
  followupDate: string
  note: string
  evidenceRef?: string
  kind?: "accident" | "damage"
  measureId?: string
  rootCauseId?: string
  controlType?: string
  verifierUserId?: string
  verifiedAt?: string
  residualRisk?: string
  implementedAt?: string
  verified?: boolean
  effective?: boolean
  lostDays?: number
  lossDescription?: string
  access: IncidentAccess
}) {
  const input = re20TextSchemas.followup.parse(args)
  // Estado triple: eficaz ⊂ verificada ⊂ implementada (RE-20-08!R6:T6 / INV.DEF.ACC!B124).
  if (input.effective && !input.verified) throw new Error("Una medida eficaz debe estar verificada.")
  if (input.verified && !input.implementedAt) throw new Error("Una medida verificada debe estar implementada: registra la fecha de implementación.")
  if (input.verified && !input.verifierUserId) throw new Error("Una medida verificada necesita quién la verificó.")
  const now = new Date().toISOString()
  const { incident, created, replay } = await db.transaction(async (tx) => {
    const found = await getInvestigableIncident(input.incidentId, args.access, tx)
    if (input.measureId) {
      const [workspace] = await tx.select().from(preventionIncidentRe20Workspaces)
        .where(eq(preventionIncidentRe20Workspaces.incidentId, found.id)).limit(1)
      const measure = workspace ? re20PublicDataSchema.parse(workspace.data).measures.find((item) => item.id === input.measureId) : undefined
      if (!measure) throw new Error("La medida del seguimiento no existe en el expediente RE-20.")
      // INV.DEF.ACC!B112: el verificador es una persona distinta del responsable de la medida.
      if (input.verifierUserId && input.verifierUserId === measure.responsibleUserId) {
        throw new Error("El verificador debe ser una persona distinta del responsable de la medida.")
      }
    }
    // Reintento del mismo seguimiento (misma medida, fecha y estado): no duplica la fila ni vuelve a acreditar.
    const [same] = await tx.select().from(preventionIncidentFollowups).where(and(
      eq(preventionIncidentFollowups.incidentId, found.id),
      eq(preventionIncidentFollowups.kind, input.kind),
      eq(preventionIncidentFollowups.followupDate, input.followupDate),
      input.measureId ? eq(preventionIncidentFollowups.measureId, input.measureId) : sql`${preventionIncidentFollowups.measureId} IS NULL`,
      eq(preventionIncidentFollowups.verified, input.verified),
      eq(preventionIncidentFollowups.effective, input.effective),
      eq(preventionIncidentFollowups.note, input.note),
    )).limit(1)
    if (same) return { incident: found, created: same, replay: true }
    const [row] = await tx.insert(preventionIncidentFollowups).values({
      id: `incflw-${nanoid()}`,
      incidentId: found.id,
      followupDate: input.followupDate,
      note: input.note,
      evidenceRef: input.evidenceRef ?? null,
      status: "completed",
      kind: input.kind,
      measureId: input.measureId ?? null,
      rootCauseId: input.rootCauseId ?? null,
      controlType: input.controlType ?? null,
      verifierUserId: input.verifierUserId ?? null,
      verifiedAt: input.verified ? (input.verifiedAt ?? now) : (input.verifiedAt ?? null),
      residualRisk: input.residualRisk ?? null,
      implementedAt: input.implementedAt ?? null,
      verified: input.verified,
      effective: input.effective,
      lostDays: input.lostDays ?? null,
      lossDescription: input.lossDescription ?? null,
      createdByUserId: args.access.ctx.userId,
      createdAt: now,
    }).returning()
    if (!row) throw new Error("No se pudo registrar el seguimiento quincenal.")
    return { incident: found, created: row, replay: false }
  })

  // Auto-acreditación PDTP: Actividad 76 (seguimiento quincenal)
  if (!replay) {
    await onIncidentFollowupRecorded({
      incidentId: incident.id,
      worksiteId: incident.worksiteId,
      followupId: created.id,
      recordedAt: now,
    })
  }

  return { ...created, idempotentReplay: replay }
}

/** Valores del catálogo en el orden del libro. Las categorías heredadas (`legacy_*`) sólo salen con `includeLegacy`. */
export async function listIncidentClassificationCatalog(category?: string, opts: { includeLegacy?: boolean } = {}) {
  return db.select().from(preventionIncidentClassificationCatalog)
    .where(and(
      eq(preventionIncidentClassificationCatalog.isActive, true),
      category ? eq(preventionIncidentClassificationCatalog.category, category) : undefined,
      opts.includeLegacy || category?.startsWith("legacy_") ? undefined : not(like(preventionIncidentClassificationCatalog.category, "legacy\\_%")),
    ))
    .orderBy(
      asc(preventionIncidentClassificationCatalog.category),
      asc(preventionIncidentClassificationCatalog.sortOrder),
      asc(preventionIncidentClassificationCatalog.name),
    )
}

/** Seguimiento canónico (RE-20-08/09) del incidente, del más reciente al más antiguo. */
export async function listIncidentFollowups(incidentId: string) {
  return db.select().from(preventionIncidentFollowups)
    .where(eq(preventionIncidentFollowups.incidentId, incidentId))
    .orderBy(desc(preventionIncidentFollowups.followupDate), desc(preventionIncidentFollowups.createdAt))
}

/** ONE PAGE (RE-20-06) publicados del incidente, del más reciente al más antiguo. */
export async function listIncidentOnePageDiffusions(incidentId: string) {
  return db.select().from(preventionIncidentDiffusion)
    .where(eq(preventionIncidentDiffusion.incidentId, incidentId))
    .orderBy(desc(preventionIncidentDiffusion.diffusedAt))
}

/* ── RE-20: Difusiones en turnos (71) y de medidas correctivas (75) ──────────
 * Doble confirmación: la prevencionista de faena marca la difusión y el
 * supervisor de faena la confirma. La acreditación PDTP ocurre al confirmar. */

export async function markIncidentDiffusion(args: {
  incidentId: string
  kind: "shift" | "corrective_measures"
  summary: string
  evidenceRef?: string
  access: IncidentAccess
}) {
  const input = re20TextSchemas.diffusion.parse(args)

  const now = new Date().toISOString()
  return db.transaction(async (tx) => {
    const incident = await getInvestigableIncident(input.incidentId, args.access, tx)
    const [created] = await tx.insert(preventionIncidentShiftDiffusions).values({
      id: `incsdif-${nanoid()}`,
      incidentId: incident.id,
      kind: input.kind,
      summary: input.summary,
      evidenceRef: input.evidenceRef ?? null,
      status: "pending_confirmation",
      markedByUserId: args.access.ctx.userId,
      markedAt: now,
      createdAt: now,
    }).returning()
    if (!created) throw new Error("No se pudo registrar la difusión.")
    return created
  })
}

export async function confirmIncidentDiffusion(args: {
  diffusionId: string
  access: IncidentAccess
}) {
  const input = re20TextSchemas.confirmDiffusion.parse(args)
  const [row] = await db.select({
    diffusion: preventionIncidentShiftDiffusions,
    worksiteId: preventionIncidents.worksiteId,
    incidentStatus: preventionIncidents.status,
  })
    .from(preventionIncidentShiftDiffusions)
    .innerJoin(preventionIncidents, eq(preventionIncidentShiftDiffusions.incidentId, preventionIncidents.id))
    .where(eq(preventionIncidentShiftDiffusions.id, input.diffusionId)).limit(1)
  if (!row) throw new Error("Difusión no encontrada.")
  /* Confirmar tiene permiso propio desde que se separó de cerrar el incidente:
   * son dos actos con dueños distintos —la n=71 y la n=75 las difunde el jefe
   * de terreno; cerrar el caso es de jefatura y tiene sus propias compuertas—,
   * y compartir `incidents:close` dejaba sin vía al responsable declarado.
   *
   * La regla de las dos personas la sostenía sólo esa diferencia de permiso, y
   * eso nunca fue suficiente: quien tuviera los dos podía marcar y confirmar su
   * propia difusión. Ahora se verifica por actor, que es lo que la regla
   * siempre quiso decir. */
  requireAccess(args.access, "prevention:incidents:diffuse", row.worksiteId)
  if (row.diffusion.markedByUserId === args.access.ctx.userId) {
    throw new Error("Quien marcó la difusión no puede confirmarla: debe hacerlo otra persona.")
  }
  if (row.diffusion.status === "confirmed") return row.diffusion // idempotente
  // Marcar la difusión ya exige un expediente abierto (`getInvestigableIncident`);
  // confirmarla acredita la n=71/75 y también escribe sobre él.
  if (row.incidentStatus === "closed") throw new Error("El incidente está cerrado y su expediente es inmutable.")

  const now = new Date().toISOString()
  const [updated] = await db.update(preventionIncidentShiftDiffusions).set({
    status: "confirmed",
    confirmedByUserId: args.access.ctx.userId,
    confirmedAt: now,
  }).where(and(eq(preventionIncidentShiftDiffusions.id, args.diffusionId), eq(preventionIncidentShiftDiffusions.status, "pending_confirmation"))).returning()
  if (!updated) throw new Error("La difusión ya fue confirmada por otra persona. Recarga y reintenta.")

  // Auto-acreditación PDTP al confirmar: Act. 71 (turnos) o 75 (medidas).
  if (updated.kind === "shift") {
    await onIncidentShiftDiffused({ incidentId: updated.incidentId, worksiteId: row.worksiteId, diffusedAt: now, userId: args.access.ctx.userId })
  } else {
    await onIncidentMeasuresDiffused({ incidentId: updated.incidentId, worksiteId: row.worksiteId, diffusedAt: now, userId: args.access.ctx.userId })
  }
  return updated
}

export async function listIncidentDiffusions(incidentId: string) {
  return db.select().from(preventionIncidentShiftDiffusions)
    .where(eq(preventionIncidentShiftDiffusions.incidentId, incidentId))
    .orderBy(desc(preventionIncidentShiftDiffusions.markedAt))
}

export const __incidentSchemas = {
  reportIncidentSchema,
  triageSchema,
  investigationSchema,
  notificationSchema,
  transitionSchema,
}

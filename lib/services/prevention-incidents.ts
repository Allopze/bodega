import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm"
import { automaticChargeDaysForSeverity } from "@/lib/prevention/charge-days"
import { totalAbsenceDays } from "@/lib/prevention/absence-allocation"
import { z } from "zod"
import { db, type DB, type Tx } from "@/db"
import { canSignOwnWork } from "@/lib/services/prevention-signing"
import {
  preventionCapaActions,
  preventionIncidentEvidence,
  preventionIncidentHistory,
  preventionIncidentInvestigations,
  preventionIncidentNotifications,
  preventionIncidentAbsencePeriods,
  preventionIncidentPeople,
  preventionIncidentPersonSensitivePayloads,
  preventionIncidents,
  preventionIncidentClassificationCatalog,
  preventionIncidentStatements,
  preventionIncidentDiffusion,
  preventionIncidentShiftDiffusions,
  preventionIncidentFollowups,
  preventionRiskReviewTriggers,
  preventionSensitiveAccessAudit,
  safetyIndicatorHistory,
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
} from "@/lib/services/pdtp-adapters/incident-accreditation-connector"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  decryptPreventionPayload,
  encryptPreventionPayload,
} from "@/lib/security/prevention-field-encryption"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import type { RequestContext } from "@/lib/services/prevention-documents/utils"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notifications"
import { onSafetyIndicatorPeriodReopened } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { invalidateClosedIndicatorPeriodWithClient, type ReopenedPeriodRevocation } from "@/lib/services/prevention-indicadores"
import { createRiskReviewTriggerWithClient } from "@/lib/services/prevention-risk-legal"
import { codeYear, todayInChile } from "@/lib/utils"

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
type IncidentClient = DB | Tx

export interface IncidentAccess {
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}

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
  sex: z.enum(["female", "male", "intersex", "unspecified"]).nullable().optional(),
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
const re20TextSchemas = {
  preliminary: z.object({
    incidentId: z.string().min(1),
    preliminaryReportText: z.string().trim().min(10).max(10000),
  }),
  statement: z.object({
    incidentId: z.string().min(1),
    kind: z.enum(["involved", "witness", "cphs"]),
    deponentName: z.string().trim().min(3).max(200),
    deponentRole: z.string().trim().max(200).optional(),
    statementText: z.string().trim().min(10).max(10000),
  }),
  onePage: z.object({
    incidentId: z.string().min(1),
    onePageSummary: z.string().trim().min(10).max(5000),
    rootCauseText: z.string().trim().min(10).max(5000),
    actionPlanSummary: z.string().trim().min(10).max(5000),
    evidenceRef: z.string().trim().max(4000).optional(),
  }),
  followup: z.object({
    incidentId: z.string().min(1),
    followupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de seguimiento inválida"),
    note: z.string().trim().min(5).max(5000),
    evidenceRef: z.string().trim().max(4000).optional(),
  }),
  diffusion: z.object({
    incidentId: z.string().min(1),
    kind: z.enum(["shift", "corrective_measures"]),
    summary: z.string().trim().min(3).max(5000),
    evidenceRef: z.string().trim().max(4000).optional(),
  }),
  confirmDiffusion: z.object({ diffusionId: z.string().min(1) }),
} as const

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
  reported: ["triage"],
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

function hasPermission(permissions: readonly string[], permission: string) {
  return permissions.includes(permission)
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: IncidentAccess, permission: string, worksiteId?: string) {
  if (!hasPermission(access.permissions, permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error("Incidente no encontrado o fuera de alcance.")
  }
}

function scopeCondition(scope: WorksiteScope) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "some" && scope.ids.length > 0) return inArray(preventionIncidents.worksiteId, scope.ids)
  return sql`false`
}

export function incidentNotificationDeadline(knownAt: string) {
  const known = new Date(knownAt)
  if (Number.isNaN(known.getTime())) throw new Error("Hora de conocimiento inválida.")
  return new Date(known.getTime() + 24 * 60 * 60 * 1000).toISOString()
}

export function requiredIncidentNotificationTypes(args: {
  eventType: IncidentEventType
  isFatalOrSerious: boolean
}): IncidentNotificationType[] {
  const result: IncidentNotificationType[] = []
  if (["work_accident", "commute_accident"].includes(args.eventType)) result.push("diat")
  if (args.eventType === "suspected_occupational_disease") result.push("diep")
  if (args.isFatalOrSerious) result.push("fatal_dt", "fatal_seremi", "restart_authorization")
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
  const [worker] = await client.select({ id: workers.id }).from(workers)
    .where(and(eq(workers.id, workerId), eq(workers.worksiteId, worksiteId), eq(workers.isActive, true))).limit(1)
  if (!worker) throw new Error("La persona vinculada no pertenece a la faena o está inactiva.")
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
}) {
  requireAccess(args.access, "prevention:incidents:report")
  const input = reportIncidentSchema.parse(args.input)
  requireAccess(args.access, "prevention:incidents:report", input.worksiteId)
  const fatalOrSerious = input.isFatalOrSerious || input.actualSeverity === "serious" || input.actualSeverity === "fatal"

  const result = await db.transaction(async (tx) => {
    for (const person of input.people) {
      if (person.workerId) await assertWorkerScope(tx, person.workerId, input.worksiteId)
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

    for (const personInput of input.people) {
      const personId = `incp-${nanoid()}`
      await tx.insert(preventionIncidentPeople).values({
        id: personId,
        incidentId,
        workerId: personInput.workerId ?? null,
        displayLabel: personInput.displayLabel,
        employerName: personInput.employerName,
        sex: personInput.sex ?? null,
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

  // Auto-acreditación PDTP: Actividades 66, 67 (fuera de la transacción)
  await onIncidentReported({ incidentId: result.incident.id, worksiteId: result.incident.worksiteId, reportedAt: result.incident.createdAt, userId: args.access.ctx.userId })

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
    await tx.insert(safetyIndicatorHistory).values({
      id: `sih-${nanoid()}`,
      worksiteId: incident.worksiteId,
      year: Number(CHILE_YEAR_FORMAT.format(new Date(incident.occurredAt))),
      month: Number(CHILE_MONTH_FORMAT.format(new Date(incident.occurredAt))),
      changeType: "corrected",
      entityType: "incident_person",
      entityId: person.id,
      reason: input.reason,
      beforeState,
      afterState,
      actorUserId: args.access.ctx.userId,
      createdAt: now,
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

async function auditIncidentSensitiveAccess(args: {
  access: IncidentAccess
  incidentId: string
  worksiteId: string
  workerId?: string | null
  purpose: string
  outcome: "granted" | "denied"
  reasonCode?: string
}) {
  await db.insert(preventionSensitiveAccessAudit).values({
    id: `psa-${nanoid()}`,
    domain: "incident",
    entityId: args.incidentId,
    subjectWorkerId: args.workerId ?? null,
    worksiteId: args.worksiteId,
    actorUserId: args.access.ctx.userId,
    action: "read_incident_sensitive",
    purpose: args.purpose,
    outcome: args.outcome,
    reasonCode: args.reasonCode ?? null,
    ip: args.access.ctx.ip ?? null,
    userAgent: args.access.ctx.userAgent ?? null,
    createdAt: nowIso(),
  })
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

export async function triagePreventionIncident(args: {
  input: unknown
  access: IncidentAccess
}) {
  requireAccess(args.access, "prevention:incidents:triage")
  const input = triageSchema.parse(args.input)
  return db.transaction(async (tx) => {
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
      },
      createdAt: now,
    })
    return updated
  })
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
    if (
      args.investigationCompletedByUserId
      && args.investigationCompletedByUserId === args.actorUserId
      && !canSignOwnWork(args.permissions)
    ) {
      throw new Error("Quien completó la investigación no puede cerrar el incidente: debe firmarlo otra persona.")
    }
  }
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
    assertIncidentTransition({
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
      reason: input.reason,
      createdAt: now,
    })
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
    let miperTrigger: typeof preventionRiskReviewTriggers.$inferSelect | null = null
    if (input.miperUpdateRequired) {
      const due = new Date()
      due.setUTCDate(due.getUTCDate() + 10)
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
        dueAt: due.toISOString().slice(0, 10),
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
      miperUpdateRequired: input.miperUpdateRequired,
      miperUpdatedAt: input.miperUpdated && miperUpdateVerified ? now : null,
      procedureUpdateRequired: input.procedureUpdateRequired,
      procedureUpdatedAt: input.procedureUpdated ? now : null,
      trainingRequired: input.trainingRequired,
      trainingCompletedAt: input.trainingCompleted ? now : null,
      completedByUserId: input.complete ? args.access.ctx.userId : null,
      completedAt: input.complete ? now : null,
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
    const now = nowIso()
    const [capa, [updated]] = await Promise.all([
      createCapaActionWithClient(tx, {
        sourceType: "incident",
        sourceId: incident.id,
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
      }, args.access.ctx.userId),
      tx.update(preventionIncidents).set({
        version: sql`${preventionIncidents.version} + 1`, updatedAt: now,
      }).where(and(eq(preventionIncidents.id, incident.id), eq(preventionIncidents.version, input.expectedVersion))).returning(),
    ])
    if (!updated) throw new Error("El incidente cambió; recarga e intenta nuevamente.")
    await appendHistory(tx, {
      incidentId: incident.id,
      changeType: "capa",
      actorUserId: args.access.ctx.userId,
      reason: "Acción CAPA creada desde la investigación",
      changeSet: { capaActionId: capa.id, code: capa.code, priority: capa.priority },
      createdAt: now,
    })
    return { incident: updated, capa }
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
  deponentName: string
  deponentRole?: string
  statementText: string
  access: IncidentAccess
}) {
  const input = re20TextSchemas.statement.parse(args)
  const now = new Date().toISOString()
  const { incident, created } = await db.transaction(async (tx) => {
    const found = await getInvestigableIncident(input.incidentId, args.access, tx)
    const [row] = await tx.insert(preventionIncidentStatements).values({
      id: `incstmt-${nanoid()}`,
      incidentId: found.id,
      kind: input.kind,
      deponentName: input.deponentName,
      deponentRole: input.deponentRole ?? null,
      statementText: input.statementText,
      signedAt: now,
      createdByUserId: args.access.ctx.userId,
      createdAt: now,
    }).returning()
    return { incident: found, created: row }
  })

  // Auto-acreditación PDTP: Actividad 69 (declaración ≤24h)
  await onIncidentStatementRecorded({ incidentId: incident.id, worksiteId: incident.worksiteId, recordedAt: now, userId: args.access.ctx.userId })

  return created
}

export async function publishOnePageDiffusion(args: {
  incidentId: string
  onePageSummary: string
  rootCauseText: string
  actionPlanSummary: string
  evidenceRef?: string
  access: IncidentAccess
}) {
  const input = re20TextSchemas.onePage.parse(args)
  const now = new Date().toISOString()
  const { incident, created } = await db.transaction(async (tx) => {
    const found = await getInvestigableIncident(input.incidentId, args.access, tx)
    const [row] = await tx.insert(preventionIncidentDiffusion).values({
      id: `incdif-${nanoid()}`,
      incidentId: found.id,
      onePageSummary: input.onePageSummary,
      rootCauseText: input.rootCauseText,
      actionPlanSummary: input.actionPlanSummary,
      evidenceRef: input.evidenceRef ?? null,
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
  access: IncidentAccess
}) {
  const input = re20TextSchemas.followup.parse(args)
  const now = new Date().toISOString()
  const { incident, created } = await db.transaction(async (tx) => {
    const found = await getInvestigableIncident(input.incidentId, args.access, tx)
    const [row] = await tx.insert(preventionIncidentFollowups).values({
      id: `incflw-${nanoid()}`,
      incidentId: found.id,
      followupDate: input.followupDate,
      note: input.note,
      evidenceRef: input.evidenceRef ?? null,
      status: "completed",
      createdByUserId: args.access.ctx.userId,
      createdAt: now,
    }).returning()
    if (!row) throw new Error("No se pudo registrar el seguimiento quincenal.")
    return { incident: found, created: row }
  })

  // Auto-acreditación PDTP: Actividad 76 (seguimiento quincenal)
  await onIncidentFollowupRecorded({
    incidentId: incident.id,
    worksiteId: incident.worksiteId,
    followupId: created.id,
    recordedAt: now,
  })

  return created
}

export async function listIncidentClassificationCatalog(category?: string) {
  if (category) {
    return db.select().from(preventionIncidentClassificationCatalog)
      .where(and(eq(preventionIncidentClassificationCatalog.category, category), eq(preventionIncidentClassificationCatalog.isActive, true)))
      .orderBy(asc(preventionIncidentClassificationCatalog.name))
  }
  return db.select().from(preventionIncidentClassificationCatalog)
    .where(eq(preventionIncidentClassificationCatalog.isActive, true))
    .orderBy(asc(preventionIncidentClassificationCatalog.category), asc(preventionIncidentClassificationCatalog.name))
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
  const [row] = await db.select({ diffusion: preventionIncidentShiftDiffusions, worksiteId: preventionIncidents.worksiteId })
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

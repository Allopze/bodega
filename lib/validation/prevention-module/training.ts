import { z } from "zod"

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
const instant = z.iso.datetime({ offset: true })
const reason = z.string().trim().min(10).max(3000)

export const TRAINING_COURSE_KINDS = [
  "induction_corporate",
  "induction_worksite",
  "odi",
  "legal_mandatory",
  "operational_talk",
  "practical_training",
  "certification",
  "retraining",
] as const

export const TRAINING_MODALITIES = ["presencial", "elearning", "mixta", "practica"] as const

/**
 * Piso regulatorio del DS 44 art. 16: capacitación de al menos 8 horas (480
 * minutos) con periodicidad no superior a 2 años (24 meses). Se expresa como
 * referencia verificable, no como constante silenciosa: cada curso declara sus
 * propios parámetros y el servicio contrasta contra estos mínimos.
 */
export const DS44_ART16_MIN_DURATION_MINUTES = 480
export const DS44_ART16_MAX_VALIDITY_MONTHS = 24
export const DS44_ART16_CITATION = "DS 44/2024 art. 16: capacitación mínima de 8 horas y periodicidad no superior a 2 años."

export const trainingCourseSchema = z.object({
  code: z.string().trim().min(2).max(60),
  name: z.string().trim().min(3).max(300),
  kind: z.enum(TRAINING_COURSE_KINDS),
  description: z.string().trim().max(3000).nullable().optional(),
  minimumDurationMinutes: z.number().int().positive().max(100_000),
  validityMonths: z.number().int().positive().max(600).nullable().optional(),
  requiresAssessment: z.boolean().default(true),
  passingScore: z.number().int().min(0).max(100).default(70),
  legalRequirementId: z.string().min(1).nullable().optional(),
  riskEntryId: z.string().min(1).nullable().optional(),
  legalBasis: z.string().trim().max(2000).nullable().optional(),
  /* El motor de acreditación (`onTrainingSessionClosed`) ya lee este campo al
   * cerrar una sesión; hasta ahora no había forma de escribirlo desde la UI de
   * creación de cursos. */
  pdtpActivityNumbers: z.array(z.number().int().positive()).default([]),
}).superRefine((value, ctx) => {
  if (value.kind === "legal_mandatory") {
    if (value.minimumDurationMinutes < DS44_ART16_MIN_DURATION_MINUTES) {
      ctx.addIssue({ code: "custom", path: ["minimumDurationMinutes"], message: `Un curso legal obligatorio no puede declarar menos de ${DS44_ART16_MIN_DURATION_MINUTES} minutos. ${DS44_ART16_CITATION}` })
    }
    if (value.validityMonths == null || value.validityMonths > DS44_ART16_MAX_VALIDITY_MONTHS) {
      ctx.addIssue({ code: "custom", path: ["validityMonths"], message: `Un curso legal obligatorio exige vigencia declarada de a lo más ${DS44_ART16_MAX_VALIDITY_MONTHS} meses. ${DS44_ART16_CITATION}` })
    }
    if ((value.legalBasis?.trim().length ?? 0) < 5) {
      ctx.addIssue({ code: "custom", path: ["legalBasis"], message: "Un curso legal obligatorio exige declarar su fundamento normativo." })
    }
  }
  if (value.kind === "odi" && !value.riskEntryId) {
    ctx.addIssue({ code: "custom", path: ["riskEntryId"], message: "Una ODI debe derivar de un peligro identificado en la MIPER." })
  }
})

export const trainingCourseVersionSchema = z.object({
  courseId: z.string().min(1),
  versionLabel: z.string().trim().min(1).max(80),
  contentOutline: z.array(z.object({
    title: z.string().trim().min(3).max(300),
    minutes: z.number().int().positive().max(10_000),
    detail: z.string().trim().max(3000).nullable().optional(),
  })).min(1, "El temario debe tener al menos un módulo."),
  durationMinutes: z.number().int().positive().max(100_000),
  modality: z.enum(TRAINING_MODALITIES),
  assessmentType: z.enum(["none", "theoretical", "practical", "both"]).default("theoretical"),
  passingScore: z.number().int().min(0).max(100).default(70),
  effectiveFrom: date.nullable().optional(),
})

export const trainingVersionTransitionSchema = z.object({
  versionId: z.string().min(1),
  toStatus: z.enum(["in_review", "observed", "approved", "published"]),
  reason,
  expectedVersion: z.number().int().positive(),
}).superRefine((value, ctx) => {
  if (value.toStatus === "observed" && value.reason.trim().length < 10) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "Observar exige un comentario para el autor." })
  }
})

export const trainingSessionSchema = z.object({
  courseVersionId: z.string().min(1),
  worksiteId: z.string().min(1),
  scheduledAt: instant,
  modality: z.enum(TRAINING_MODALITIES),
  location: z.string().trim().max(300).nullable().optional(),
  instructorUserId: z.string().min(1).nullable().optional(),
  instructorExternalName: z.string().trim().min(3).max(300).nullable().optional(),
  instructorCompetencyEvidence: z.string().trim().min(5).max(2000),
  convenedWorkerIds: z.array(z.string().min(1)).default([]),
}).superRefine((value, ctx) => {
  if (!value.instructorUserId && !value.instructorExternalName) {
    ctx.addIssue({ code: "custom", path: ["instructorUserId"], message: "Debe indicarse un relator interno o externo." })
  }
})

export const trainingAttendanceRecordSchema = z.object({
  sessionId: z.string().min(1),
  entries: z.array(z.object({
    workerId: z.string().min(1),
    status: z.enum(["convened", "attended", "absent", "excused"]),
    attendanceMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
    assessmentScore: z.number().int().min(0).max(100).nullable().optional(),
    excuseReason: z.string().trim().max(1000).nullable().optional(),
    evidenceReference: z.string().trim().max(2000).nullable().optional(),
  })).min(1),
}).superRefine((value, ctx) => {
  value.entries.forEach((entry, index) => {
    if (entry.status === "excused" && (entry.excuseReason?.trim().length ?? 0) < 5) {
      ctx.addIssue({ code: "custom", path: ["entries", index, "excuseReason"], message: "Una justificación exige motivo." })
    }
  })
})

export const trainingSessionCloseSchema = z.object({
  sessionId: z.string().min(1),
  startedAt: instant,
  endedAt: instant,
  expectedVersion: z.number().int().positive(),
}).superRefine((value, ctx) => {
  if (new Date(value.endedAt).getTime() <= new Date(value.startedAt).getTime()) {
    ctx.addIssue({ code: "custom", path: ["endedAt"], message: "El término debe ser posterior al inicio." })
  }
})

export const trainingSessionCancelSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().trim().min(5).max(2000),
  expectedVersion: z.number().int().positive(),
})

export const trainingAcknowledgementSchema = z.object({
  attendanceId: z.string().min(1),
  method: z.enum(["platform_click", "signed_document"]),
  evidenceReference: z.string().trim().max(2000).nullable().optional(),
})

export const competencyConvalidationSchema = z.object({
  workerId: z.string().min(1),
  courseId: z.string().min(1),
  sourceType: z.enum(["convalidation", "external_certificate"]),
  grantedAt: date,
  expiresAt: date.nullable().optional(),
  evidenceReference: z.string().trim().min(3).max(2000),
  externalIssuer: z.string().trim().max(300).nullable().optional(),
  externalCertificateNumber: z.string().trim().max(200).nullable().optional(),
  justification: reason,
}).superRefine((value, ctx) => {
  if (value.sourceType === "external_certificate" && (value.externalIssuer?.trim().length ?? 0) < 2) {
    ctx.addIssue({ code: "custom", path: ["externalIssuer"], message: "Un certificado externo exige declarar el organismo emisor." })
  }
  if (value.expiresAt && value.expiresAt <= value.grantedAt) {
    ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "El vencimiento debe ser posterior al otorgamiento." })
  }
})

export const competencyRevocationSchema = z.object({
  competencyId: z.string().min(1),
  reason: z.string().trim().min(5).max(2000),
})

export const competencyRequirementSchema = z.object({
  courseId: z.string().min(1),
  scopeType: z.enum(["global", "worksite", "position", "task", "committee"]),
  scopeValue: z.string().trim().max(300).nullable().optional(),
  worksiteId: z.string().min(1).nullable().optional(),
  enforcement: z.enum(["blocking", "warning"]).default("warning"),
  reason,
  legalRequirementId: z.string().min(1).nullable().optional(),
  riskEntryId: z.string().min(1).nullable().optional(),
}).superRefine((value, ctx) => {
  if ((value.scopeType === "position" || value.scopeType === "task") && !value.scopeValue?.trim()) {
    ctx.addIssue({ code: "custom", path: ["scopeValue"], message: "Un requisito por cargo o tarea exige indicar cuál." })
  }
  // En `committee` el `scopeValue` es el id del comité al que aplica.
  if (value.scopeType === "committee" && !value.scopeValue?.trim()) {
    ctx.addIssue({ code: "custom", path: ["scopeValue"], message: "Un requisito por comité exige indicar cuál." })
  }
  if (value.scopeType === "worksite" && !value.worksiteId) {
    ctx.addIssue({ code: "custom", path: ["worksiteId"], message: "Un requisito por faena exige indicar la faena." })
  }
})

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
  year:             z.coerce.number().int().min(2026).max(2100),
  month:            z.coerce.number().int().min(1).max(12),
  week:             z.coerce.number().int().min(1).max(4),
  executedQuantity: z.coerce.number().min(0),
  evidenceText:     z.string().max(2000).optional().or(z.literal("")),
  evidenceUrl:      z.string().max(500).optional().or(z.literal("")),
  evidencePhotos:   z.array(z.string().max(500)).default([]),
})

export const pdtpProgramTransitionSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  action: z.enum(["approve_jdpr", "sign_legal", "activate"]),
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

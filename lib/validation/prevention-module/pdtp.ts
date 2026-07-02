import { z } from "zod"

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

import { z } from "zod"

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

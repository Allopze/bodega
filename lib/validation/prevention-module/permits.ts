import { z } from "zod"

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

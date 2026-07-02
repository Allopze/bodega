import { z } from "zod"

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

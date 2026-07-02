import { z } from "zod"

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

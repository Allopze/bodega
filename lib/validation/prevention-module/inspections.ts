import { z } from "zod"

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

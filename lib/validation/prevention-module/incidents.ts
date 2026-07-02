import { z } from "zod"

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

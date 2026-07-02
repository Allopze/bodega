import { z } from "zod"

export const contractorCreateSchema = z.object({
  rut:                 z.string().trim().min(1, "RUT requerido").max(20),
  name:                z.string().trim().min(1, "Razón social requerida").max(200),
  legalRepresentative:  z.string().trim().max(160).optional().or(z.literal("")),
  contact:             z.string().trim().max(160).optional().or(z.literal("")),
  status:              z.enum(["activo", "inactivo", "bloqueado"]).default("activo"),
})

export const contractorWorkerAddSchema = z.object({
  contractorId: z.string().min(1, "Contratista requerido"),
  workerId:     z.string().min(1, "Trabajador requerido"),
  position:     z.string().trim().min(1, "Cargo requerido").max(120),
  startDate:    z.string().min(1, "Fecha de inicio requerida"),
  endDate:      z.string().optional().or(z.literal("")),
})

export const contractorDocumentAddSchema = z.object({
  contractorId: z.string().min(1, "Contratista requerido"),
  type:         z.enum([
    "certificado_antecedentes",
    "contrato_trabajo",
    "epp_entregado",
    "capacitacion_ods",
    "examen_preocupacional",
    "reglamento_interno",
    "otro",
  ]),
  versionId: z.string().optional().or(z.literal("")),
  status:    z.enum(["pendiente", "vigente", "vencido"]).default("pendiente"),
  expiresAt: z.string().optional().or(z.literal("")),
})

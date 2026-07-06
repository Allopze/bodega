import { z } from "zod"

/**
 * Whitelist de rutas válidas para evidencia PDTP. Solo se aceptan paths
 * bajo `storage/pdtp-evidence/<name>` donde `<name>` es un nombre
 * seguro (nanoid + extensión `.pdf | .jpg | .jpeg | .png`).
 *
 * Esto previene que la Server Action persista URLs arbitrarias que
 * luego un endpoint podría servir (path traversal / open redirect).
 */
const PDTP_EVIDENCE_URL_RE = /^storage\/pdtp-evidence\/[A-Za-z0-9_-]{1,60}\.(pdf|jpg|jpeg|png)$/i

const pdtpEvidenceUrl = z
  .string()
  .regex(PDTP_EVIDENCE_URL_RE, "La URL de evidencia debe empezar con storage/pdtp-evidence/ y terminar en .pdf/.jpg/.jpeg/.png")
  .or(z.literal(""))

const pdtpEvidencePhotoItem = z
  .string()
  .regex(PDTP_EVIDENCE_URL_RE, "Cada foto debe estar bajo storage/pdtp-evidence/ con extensión válida")

export const pdtpExecutionSchema = z.object({
  activityId:       z.string().min(1, "Actividad requerida"),
  worksiteId:       z.string().min(1, "Faena requerida"),
  year:             z.coerce.number().int().min(2000).max(2100),
  month:            z.coerce.number().int().min(1).max(12),
  week:             z.coerce.number().int().min(1).max(4),
  executedQuantity: z.coerce.number().min(0),
  evidenceText:     z.string().max(2000).optional().or(z.literal("")),
  evidenceUrl:      pdtpEvidenceUrl.optional(),
  evidencePhotos:   z.array(pdtpEvidencePhotoItem).default([]),
})

export const pdtpExecutionApprovalSchema = z.object({
  executionId: z.string().min(1, "Ejecución requerida"),
})

export const pdtpExecutionRejectionSchema = z.object({
  executionId: z.string().min(1, "Ejecución requerida"),
  reason: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(1000),
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

export const pdtpActivityOverrideSchema = z.object({
  activityId: z.string().min(1, "Actividad requerida"),
  worksiteId: z.string().min(1, "Faena requerida"),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  week: z.coerce.number().int().min(1).max(4),
  plannedQuantity: z.coerce.number().min(0),
})

export const pdtpProgramCreateSchema = z.object({
  year: z.coerce.number().int().min(2024, "El año debe ser al menos 2024"),
  title: z.string().trim().min(1, "Título requerido").max(200, "Máximo 200 caracteres"),
  copySheetsFromProgramId: z.string().optional(),
})

export const pdtpProgramUpdateSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  title: z.string().trim().min(1).max(200).optional(),
  complianceTarget: z.coerce.number().min(0).max(1).optional(),
})

export const pdtpProgramDeleteSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
})

export const pdtpSheetCreateSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  code: z.string().trim().min(1, "Código requerido").max(50).regex(/^[a-z0-9_]+$/, "Solo letras minúsculas, números y guiones bajos"),
  label: z.string().trim().min(1, "Etiqueta requerida").max(200),
  area: z.string().trim().min(1, "Área requerida").max(100),
})

export const pdtpSheetDeleteSchema = z.object({
  sheetId: z.string().min(1, "Hoja requerida"),
  programId: z.string().min(1, "Programa requerido"),
})

export const pdtpActivityDeleteSchema = z.object({
  activityId: z.string().min(1, "Actividad requerida"),
})

export const pdtpActivityReorderSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  orderedIds: z.array(z.string().min(1)).min(1, "Al menos una actividad"),
})

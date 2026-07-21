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
  year: z.coerce.number().int().min(2024, "El año debe ser al menos 2024").max(2100, "El año no puede superar 2100"),
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

export const pdtpObjectiveRenameSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  objectiveOrder: z.coerce.number().int().min(1).max(8),
  objective: z.string().trim().min(1, "Objetivo requerido").max(200),
})

// ── Checklist → Plan de Acción → Seguimiento ────────────────────────────────

const pdtpChecklistItemSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  kind: z.enum([
    "cumple_nocumple_obs", "cumple_nocumple_na_obs", "entregado_obs", "apto_obs",
    "si_no_obs", "text", "date", "select", "multiselect", "signature", "readonly",
  ]),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  danoPotencial: z.enum(["leve", "moderado", "grave", "fatal"]).optional(),
})

const pdtpChecklistSectionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  items: z.array(pdtpChecklistItemSchema).min(1, "La sección debe tener al menos un ítem"),
  appliesWhen: z.array(z.string()).optional(),
  countsForCompliance: z.boolean().optional(),
  hasActionCorrectiva: z.boolean().optional(),
  requiresPermission: z.string().optional(),
  weekNumber: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
})

/** Estructura mínima de ChecklistDefinition (lib/sst/types.ts) — editor JSON-asistido (§8 del plan). */
export const pdtpChecklistDefinitionSchema = z.object({
  code: z.string().trim().min(1),
  version: z.string().trim().min(1),
  revisionDate: z.string().trim().min(1),
  title: z.string().trim().min(1),
  tipo: z.enum(["nuevo", "seguimiento"]),
  subtitle: z.string().optional(),
  legalFramework: z.array(z.string()).default([]),
  applicableTo: z.string().default(""),
  objective: z.string().optional(),
  frequencySuggested: z.string().optional(),
  evaluationCriteria: z.string().optional(),
  sections: z.array(pdtpChecklistSectionSchema).min(1, "Debe haber al menos una sección"),
  closingAct: z.object({
    title: z.string(),
    resultOptions: z.array(z.object({ value: z.string(), label: z.string() })),
    hasRestrictions: z.boolean().optional(),
    signatureRoles: z.array(z.string()),
  }),
})

export const pdtpChecklistTemplateSaveSchema = z.object({
  activityId: z.string().min(1, "Actividad requerida"),
  programId: z.string().min(1, "Programa requerido"),
  label: z.string().trim().min(1, "Etiqueta requerida").max(200),
  definitionRaw: z.string().min(1, "La definición JSON es requerida"),
})

export const pdtpChecklistTemplateDeleteSchema = z.object({
  checklistId: z.string().min(1, "Plantilla requerida"),
  programId: z.string().min(1, "Programa requerido"),
})

export const pdtpChecklistResponseItemSchema = z.object({
  seccionId: z.string().min(1),
  itemId: z.string().min(1),
  estado: z.enum(["cumple", "no_cumple", "na", "entregado", "no_entregado", "apto", "no_apto", "si", "no"]).nullable(),
  observacion: z.string().max(2000).optional(),
  accionCorrectiva: z.string().max(2000).optional(),
})

export const pdtpChecklistResponsesUpsertSchema = z.object({
  instanceId: z.string().min(1, "Instancia requerida"),
  programId: z.string().min(1, "Programa requerido"),
  responses: z.array(pdtpChecklistResponseItemSchema).min(1),
})

export const pdtpChecklistStartSchema = z.object({
  executionId: z.string().min(1, "Ejecución requerida"),
  // Multi-sujeto (PLAN_INTEGRACION §4): opcionales. Omisión → instancia de
  // faena única (subjectId=''). `subjectType` acota el catálogo de sujetos;
  // `subjectId` referencia fuelVehicles.id/workers.id o un código libre;
  // `subjectLabel` se persiste denormalizado para UI/export.
  subjectType: z.enum(["equipo", "trabajador", "contenedor", "extintor", "carro"]).nullish(),
  subjectId: z.string().trim().max(100).optional(),
  subjectLabel: z.string().trim().max(200).nullish(),
})

export const pdtpChecklistSubmitSchema = z.object({
  instanceId: z.string().min(1, "Instancia requerida"),
  programId: z.string().min(1, "Programa requerido"),
})

export const pdtpActionPlanCreateSchema = z.object({
  executionId: z.string().min(1, "Ejecución requerida"),
  hallazgo: z.string().trim().min(1, "Hallazgo requerido").max(1000),
  accion: z.string().trim().min(1, "Acción requerida").max(1000),
  responsableRole: z.string().trim().min(1, "Rol responsable requerido"),
  responsable: z.string().trim().min(1, "Responsable requerido").max(200),
  responsableUserId: z.string().optional(),
  plazo: z.string().trim().min(1, "Plazo requerido"),
  prioridad: z.enum(["alta", "media", "baja"]).default("media"),
  // Daño potencial del hallazgo (módulo 04, Evidencia Objetiva No Planeada).
  // Opcional: cuando se indica, la UI deriva prioridad y plazo desde aquí
  // (PLAN_INTEGRACION §5.4). Se persiste solo como guía; la prioridad/plazo
  // efectivos son los que arriba se envían (coherentes con la derivación).
  dañoPotencial: z.enum(["leve", "moderado", "grave", "fatal"]).optional(),
})

export const pdtpActionPlanUpdateSchema = z.object({
  itemId: z.string().min(1, "Acción requerida"),
  hallazgo: z.string().trim().min(1).max(1000).optional(),
  accion: z.string().trim().min(1).max(1000).optional(),
  responsableRole: z.string().trim().min(1).optional(),
  responsable: z.string().trim().min(1).max(200).optional(),
  responsableUserId: z.string().optional(),
  plazo: z.string().trim().min(1).optional(),
  prioridad: z.enum(["alta", "media", "baja"]).optional(),
  estado: z.enum(["pendiente", "en_proceso", "completado", "verificado", "reabierto"]).optional(),
})

export const pdtpActionPlanDeleteSchema = z.object({
  itemId: z.string().min(1, "Acción requerida"),
})

export const pdtpActionPlanVerifySchema = z.object({
  itemId: z.string().min(1, "Acción requerida"),
  observacion: z.string().max(1000).optional(),
  effectivenessAssessment: z.string().trim().min(5, "Documenta cómo se comprobó la eficacia").max(3000),
})

export const pdtpActionPlanReopenSchema = z.object({
  itemId: z.string().min(1, "Acción requerida"),
  motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(1000),
})

export const pdtpFollowupAddSchema = z.object({
  actionPlanItemId: z.string().min(1, "Acción requerida"),
  observacion: z.string().max(2000).optional(),
  estadoNuevo: z.enum(["pendiente", "en_proceso", "completado", "verificado", "reabierto"]).optional(),
  evidenciaUrl: pdtpEvidenceUrl.optional(),
  evidenciaPhotos: z.array(pdtpEvidencePhotoItem).default([]),
})

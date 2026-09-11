import { z } from "zod"
import { WORKER_CAPABILITY_CODE_PATTERN } from "@/lib/services/worker-positions/normalization"

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
  // El techo evita que un valor absurdo llegue a `numeric(10,2)` y reviente
  // como error de base de datos en vez de como error de formulario.
  plannedQuantity: z.coerce.number().min(0).max(100000),
})

/** 12 meses × 4 semanas: el máximo que admiten los CHECK de
 *  `pdtp_activity_schedule`. */
const MAX_SCHEDULE_CELLS = 48

const scheduleCellArraySchema = z.array(pdtpScheduleCellSchema).max(MAX_SCHEDULE_CELLS).superRefine((cells, ctx) => {
  // Dos celdas con el mismo (mes, semana) generan el mismo id determinista:
  // una pisaría a la otra y la lista de celdas a conservar quedaría sucia.
  const seen = new Set<string>()
  for (const cell of cells) {
    const key = `${cell.month}-${cell.week}`
    if (seen.has(key)) {
      ctx.addIssue({ code: "custom", message: `Semana repetida en la planificación (mes ${cell.month}, semana ${cell.week})` })
      return
    }
    seen.add(key)
  }
})

export const pdtpRecurrenceRuleSchema = z.object({
  frequency: z.enum(["weekly", "monthly", "quarterly", "semiannual", "annual", "custom"]),
  interval: z.coerce.number().int().min(1).max(52).default(1),
  plannedQuantity: z.coerce.number().positive().max(100000).default(1),
  months: z.array(z.coerce.number().int().min(1).max(12)).max(12).optional(),
  weekOfMonth: z.coerce.number().int().min(1).max(4).default(1),
}).superRefine((rule, ctx) => {
  if (rule.frequency === "custom" && !rule.months?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["months"],
      message: "Selecciona al menos un mes para la recurrencia personalizada",
    })
  }
})

const pdtpScheduleModeSchema = z.enum(["scheduled", "on_demand", "triggered"])
const pdtpScheduleClassificationStatusSchema = z.enum(["confirmed", "needs_review"])
const pdtpIndicatorModeSchema = z.enum(["planned_vs_completed", "closed_on_time", "completed_count", "not_applicable", "coverage"])
const pdtpSubjectSourceSchema = z.enum([
  "dotacion",
  "extintores",
  "expuestos_ges",
  "equipos",
  "trabajadores_nuevos",
  "trabajadores_capacidad",
])
const pdtpSubjectCapabilityCodesSchema = z.array(
  z.string().trim().toLowerCase()
    .regex(WORKER_CAPABILITY_CODE_PATTERN, "Código de capacidad inválido"),
).max(20, "Selecciona como máximo 20 capacidades")
  .transform((codes) => [...new Set(codes)].sort())

function validateSubjectSourceConfiguration(
  value: { subjectSource?: string | null; subjectCapabilityCodes?: string[] | null },
  ctx: z.RefinementCtx,
) {
  if (value.subjectSource === "trabajadores_capacidad" && !value.subjectCapabilityCodes?.length) {
    ctx.addIssue({
      code: "custom",
      path: ["subjectCapabilityCodes"],
      message: "Selecciona al menos una capacidad para construir el padrón",
    })
  }
  if (value.subjectSource !== undefined
    && value.subjectSource !== "trabajadores_capacidad"
    && value.subjectCapabilityCodes?.length) {
    ctx.addIssue({
      code: "custom",
      path: ["subjectCapabilityCodes"],
      message: "Las capacidades sólo corresponden a la fuente de trabajadores por capacidad",
    })
  }
}

export const pdtpActivityUpdateSchema = z.object({
  activityId: z.string().min(1, "Actividad requerida"),
  activity: z.string().trim().max(4000).optional(),
  program: z.string().trim().max(2000).optional(),
  notes: z.string().max(5000).optional().or(z.literal("")),
  responsibleSlugs: z.array(z.string().min(1)).optional(),
  responsibleDisplay: z.string().trim().max(160).optional(),
  audienceRoles: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  scheduleMode: pdtpScheduleModeSchema.optional(),
  scheduleClassificationStatus: pdtpScheduleClassificationStatusSchema.optional(),
  recurrenceRule: pdtpRecurrenceRuleSchema.nullable().optional(),
  triggerType: z.string().trim().max(100).nullable().optional(),
  triggerDescription: z.string().trim().max(2000).nullable().optional(),
  dueDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
  dueHours: z.coerce.number().int().min(0).max(8760).nullable().optional(),
  evidenceRequirement: z.string().trim().max(3000).nullable().optional(),
  indicatorMode: pdtpIndicatorModeSchema.optional(),
  subjectSource: pdtpSubjectSourceSchema.nullable().optional(),
  subjectCapabilityCodes: pdtpSubjectCapabilityCodesSchema.nullable().optional(),
  targetValue: z.coerce.number().min(0).max(1000000).nullable().optional(),
  targetUnit: z.string().trim().max(80).nullable().optional(),
  scheduleOverrides: scheduleCellArraySchema.optional(),
  scheduleReplaceConfirmed: z.coerce.boolean().optional(),
  expectedScheduleFingerprint: z.string().max(4000).nullable().optional(),
}).superRefine((value, ctx) => {
  // Paridad con pdtpActivityAddSchema: sin esto se podía dejar una actividad
  // "por evento" sin decir cuál es el evento.
  if (value.scheduleMode === "triggered" && value.triggerDescription !== undefined && !value.triggerDescription?.trim()) {
    ctx.addIssue({ code: "custom", path: ["triggerDescription"], message: "Describe el evento que genera la obligación" })
  }
  if (value.scheduleMode === "scheduled" && value.recurrenceRule === null) {
    ctx.addIssue({ code: "custom", path: ["recurrenceRule"], message: "Define una frecuencia para una actividad programada" })
  }
  validateSubjectSourceConfiguration(value, ctx)
})

export const pdtpActivityAddSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  activity: z.string().trim().min(1).max(4000),
  program: z.string().trim().min(1).max(2000),
  responsibleSlugs: z.array(z.string().min(1)).min(1, "Al menos un responsable"),
  responsibleDisplay: z.string().trim().min(1).max(160),
  audienceRoles: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  scheduleMode: pdtpScheduleModeSchema.default("scheduled"),
  scheduleClassificationStatus: pdtpScheduleClassificationStatusSchema.default("confirmed"),
  recurrenceRule: pdtpRecurrenceRuleSchema.nullable().optional(),
  triggerType: z.string().trim().max(100).nullable().optional(),
  triggerDescription: z.string().trim().max(2000).nullable().optional(),
  dueDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
  dueHours: z.coerce.number().int().min(0).max(8760).nullable().optional(),
  evidenceRequirement: z.string().trim().max(3000).nullable().optional(),
  indicatorMode: pdtpIndicatorModeSchema.default("planned_vs_completed"),
  subjectSource: pdtpSubjectSourceSchema.nullable().optional(),
  subjectCapabilityCodes: pdtpSubjectCapabilityCodesSchema.nullable().optional(),
  targetValue: z.coerce.number().min(0).max(1000000).nullable().optional(),
  targetUnit: z.string().trim().max(80).nullable().optional(),
  notes: z.string().max(5000).optional().or(z.literal("")),
  sheetCodes: z.array(z.string().min(1)).min(1, "Al menos una hoja"),
  schedule: scheduleCellArraySchema.optional(),
}).superRefine((value, ctx) => {
  if (value.scheduleMode === "triggered" && !value.triggerDescription?.trim()) {
    ctx.addIssue({ code: "custom", path: ["triggerDescription"], message: "Describe el evento que genera la obligación" })
  }
  validateSubjectSourceConfiguration(value, ctx)
})

export const pdtpActivityOverrideSchema = z.object({
  activityId: z.string().min(1, "Actividad requerida"),
  worksiteId: z.string().min(1, "Faena requerida"),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  week: z.coerce.number().int().min(1).max(4),
  plannedQuantity: z.coerce.number().min(0),
  reason: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(1000),
})

export const pdtpProgramWorksitesSetSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  worksiteIds: z.array(z.string().min(1)).max(200),
})

export const pdtpActivityWorksiteExclusionSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  activityId: z.string().min(1, "Actividad requerida"),
  worksiteId: z.string().min(1, "Faena requerida"),
  reason: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(1000),
})

export const pdtpObligationCreateSchema = z.object({
  activityId: z.string().min(1, "Actividad requerida"),
  worksiteId: z.string().min(1, "Faena requerida"),
  origin: z.enum(["manual", "integration"]),
  clientRequestId: z.string().trim().min(8).max(500),
  sourceType: z.string().trim().min(1).max(100).nullable().optional(),
  sourceId: z.string().trim().min(1).max(500).nullable().optional(),
  sourceOccurredAt: z.iso.datetime({ offset: true }).nullable().optional(),
  plannedQuantity: z.coerce.number().positive().max(1000000).default(1),
  manualReason: z.string().trim().max(3000).nullable().optional(),
  sourceMetadata: z.record(z.string(), z.unknown()).default({}),
}).superRefine((value, ctx) => {
  if (value.origin === "manual" && (value.manualReason?.length ?? 0) < 10) {
    ctx.addIssue({ code: "custom", path: ["manualReason"], message: "El registro manual exige un motivo de al menos 10 caracteres" })
  }
})

export const pdtpObligationReportSchema = z.object({
  obligationId: z.string().min(1, "Obligación requerida"),
  executedQuantity: z.coerce.number().positive().max(1000000),
  evidenceText: z.string().trim().max(5000).nullable().optional(),
  evidenceUrl: pdtpEvidenceUrl.nullable().optional(),
  evidencePhotos: z.array(pdtpEvidencePhotoItem).max(20).default([]),
  reportedAt: z.iso.datetime({ offset: true }).optional(),
})

export const pdtpObligationCancelSchema = z.object({
  obligationId: z.string().min(1, "Obligación requerida"),
  reason: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(3000),
})

export const pdtpProgramCreateSchema = z.object({
  year: z.coerce.number().int().min(2024, "El año debe ser al menos 2024").max(2100, "El año no puede superar 2100"),
})

export const pdtpTemplatePublishSchema = z.object({
  sourceProgramId: z.string().min(1, "Programa requerido"),
  name: z.string().trim().min(3, "El nombre debe tener al menos 3 caracteres").max(200),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
})

export const pdtpProgramUpdateSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  title: z.string().trim().min(1).max(200).optional(),
  complianceTarget: z.coerce.number().min(0).max(1).optional(),
})

export const pdtpProgramDeleteSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
})

export const pdtpReconcileDeclaredActorSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  historyEntryId: z.string().min(1, "Declaración requerida"),
  linkedUserId: z.string().min(1).nullable(),
  reason: z.string().trim().min(10, "Explica en al menos 10 caracteres a qué persona corresponde o por qué se desvincula."),
})

export const pdtpProgramLifecycleReasonSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  reason: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(3000),
})

export const pdtpApprovalDecisionSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  stepId: z.string().min(1, "Paso de aprobación requerido"),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().max(3000).optional(),
}).superRefine((value, ctx) => {
  if (value.decision === "rejected" && (value.reason?.trim().length ?? 0) < 10) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "El motivo debe tener al menos 10 caracteres" })
  }
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
  reason: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(3000),
  effectiveFrom: z.iso.date("Fecha efectiva inválida"),
})

export const pdtpActivityDuplicateSchema = z.object({
  activityId: z.string().min(1, "Actividad requerida"),
})

export const pdtpActivityBatchUpdateSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  activityIds: z.array(z.string().min(1)).min(1, "Selecciona al menos una actividad").max(200),
  responsibleSlugs: z.array(z.string().min(1)).min(1).optional(),
  responsibleDisplay: z.string().trim().min(1).max(160).optional(),
  evidenceRequirement: z.string().trim().max(3000).nullable().optional(),
}).refine((value) => value.responsibleSlugs !== undefined || value.evidenceRequirement !== undefined, {
  message: "Selecciona al menos un cambio para aplicar",
})

export const pdtpActivityReorderSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  orderedIds: z.array(z.string().min(1)).min(1, "Al menos una actividad"),
})

export const pdtpActivityWorksiteAdjustmentSchema = z.object({
  activityId: z.string().min(1, "Actividad requerida"),
  worksiteId: z.string().min(1, "Faena requerida"),
  excluded: z.boolean(),
  reason: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(3000),
  expectedSubjectCount: z.coerce.number().int().min(0).nullable().optional(),
  targetCoveragePercent: z.coerce.number().min(0).max(100).nullable().optional(),
  responsibleSlugs: z.array(z.string().trim().min(1)).min(1).nullable().optional(),
  responsibleDisplay: z.string().trim().min(1).max(160).nullable().optional(),
  schedule: z.array(pdtpScheduleCellSchema).nullable().optional(),
})

// ── Checklist → Plan de Acción → Seguimiento ────────────────────────────────

const pdtpChecklistItemSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  kind: z.enum([
    "cumple_nocumple_obs", "cumple_nocumple_na_obs", "entregado_obs", "apto_obs",
    // `si_no_na_obs` es la columna "Usa" del Anexo 3 (Sí/No/N/A) y estaba en el
    // catálogo (`lib/sst/types.ts`) pero no acá, así que la definición de EPP
    // no pasaba su propio validador.
    "si_no_obs", "si_no_na_obs", "bueno_regular_malo_obs", "bueno_regular_malo_na_obs", "bueno_regular_malo_na_nt_obs",
    "text", "textarea", "date", "select", "multiselect", "signature", "readonly",
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
  estado: z.enum(["cumple", "regular", "no_cumple", "na", "no_tiene", "entregado", "no_entregado", "apto", "no_apto", "si", "no"]).nullable(),
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
  subjectResourceId: z.string().trim().max(100).optional(),
  subjectContainerId: z.string().trim().max(100).optional(),
  subjectLabel: z.string().trim().max(200).nullish(),
}).superRefine((value, ctx) => {
  if (value.subjectType === "extintor" && !value.subjectResourceId) {
    ctx.addIssue({
      code: "custom",
      path: ["subjectResourceId"],
      message: "Selecciona un extintor del inventario de la faena.",
    })
  }
  // El contenedor era el único sujeto que seguía siendo texto libre, por no
  // haber padrón. Con el catálogo en pie, se exige igual que el extintor.
  if (value.subjectType === "contenedor" && !value.subjectContainerId) {
    ctx.addIssue({
      code: "custom",
      path: ["subjectContainerId"],
      message: "Selecciona un contenedor del catálogo de la faena.",
    })
  }
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
  // Daño potencial del hallazgo (módulo 04, Evidencia Objetiva No Planeada —
  // columna "DAÑO POTENCIAL" del Anexo 8). Opcional: cuando se indica, la UI
  // deriva prioridad y plazo desde aquí (PLAN_INTEGRACION §5.4). Se persiste
  // en `pdtp_action_plan.dano_potencial` además de derivar, porque la
  // derivación pierde información: grave y fatal dan ambos prioridad alta.
  dañoPotencial: z.enum(["leve", "moderado", "grave", "fatal"]).optional(),
  // Anexo 8, columna "NORMATIVA LEGAL APLICABLE".
  normativaLegal: z.string().trim().max(500).optional(),
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

import { z } from "zod"
import { WORKER_CAPABILITY_CODE_PATTERN } from "@/lib/worker-positions/capability-code"

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
  // Semanas del mes (1-4) para ocurrencias no-semanales (ej. quincenal:
  // weeks: [1, 3]). Opcional y sin default: ausente significa "usar
  // weekOfMonth", igual que antes de este campo (ver `resolveWeeks` en
  // lib/services/pdtp/recurrence.ts). Normalizado a único y ordenado para
  // que el orden de captura no afecte `recurrenceRulesEqual`.
  weeks: z.array(z.coerce.number().int().min(1).max(4)).min(1).max(4).optional()
    .transform((weeks) => (weeks ? [...new Set(weeks)].sort((a, b) => a - b) : weeks)),
}).superRefine((rule, ctx) => {
  if (rule.frequency === "custom" && !rule.months?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["months"],
      message: "Selecciona al menos un mes para la recurrencia personalizada",
    })
  }
})

const pdtpScheduleDate = z.iso.date("Fecha de programación inválida")
const pdtpScheduleDefinitionBase = z.object({ version: z.literal(1) })

export const pdtpScheduleDefinitionSchema = z.discriminatedUnion("kind", [
  pdtpScheduleDefinitionBase.extend({
    kind: z.literal("one_time"),
    date: pdtpScheduleDate,
  }),
  pdtpScheduleDefinitionBase.extend({
    kind: z.literal("recurring"),
    startDate: pdtpScheduleDate,
    endDate: pdtpScheduleDate,
    every: z.coerce.number().int().min(1).max(366),
    unit: z.enum(["day", "week", "month", "year"]),
    weekdays: z.array(z.coerce.number().int().min(1).max(7)).max(7).optional()
      .transform((days) => days ? [...new Set(days)].sort((a, b) => a - b) : days),
    dayOfMonth: z.coerce.number().int().min(1).max(31).optional(),
    plannedQuantity: z.coerce.number().positive().max(100000).optional().default(1),
  }).superRefine((value, ctx) => {
    if (value.endDate < value.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "La fecha final debe ser posterior al inicio" })
    if (value.unit !== "week" && value.weekdays?.length) ctx.addIssue({ code: "custom", path: ["weekdays"], message: "Los días de semana sólo aplican a una recurrencia semanal" })
  }),
  pdtpScheduleDefinitionBase.extend({
    kind: z.literal("event"),
    triggerConnectorKey: z.string().trim().min(1).max(100),
    triggerEventKey: z.string().trim().min(1).max(100),
    dueValue: z.coerce.number().int().positive().max(8760),
    dueUnit: z.enum(["hour", "day"]),
  }),
  pdtpScheduleDefinitionBase.extend({
    kind: z.literal("on_demand"),
    dueValue: z.coerce.number().int().positive().max(8760),
    dueUnit: z.enum(["hour", "day"]),
  }),
  pdtpScheduleDefinitionBase.extend({ kind: z.literal("legacy_grid") }),
])

export const pdtpCompletionPolicySchema = z.enum(["manual_confirmed", "source_completed", "source_approved", "checklist_completed"])
export const pdtpEvidenceKindSchema = z.enum(["file", "photo", "checklist", "signature", "generated_record"])
export const pdtpActivityExecutionConfigSchema = z.object({
  destinationConnectorKey: z.string().trim().min(1).max(100),
  accreditationBindingId: z.string().trim().min(1).nullable().optional(),
  completionPolicy: pdtpCompletionPolicySchema.default("manual_confirmed"),
  evidencePolicy: z.object({
    required: z.boolean().default(false),
    acceptedKinds: z.array(pdtpEvidenceKindSchema).max(5).transform((kinds) => [...new Set(kinds)]),
  }),
}).superRefine((value, ctx) => {
  if (value.evidencePolicy.required && value.evidencePolicy.acceptedKinds.length === 0) {
    ctx.addIssue({ code: "custom", path: ["evidencePolicy", "acceptedKinds"], message: "Selecciona al menos un mecanismo de evidencia" })
  }
})

export const pdtpScheduledInstanceStartSchema = z.object({
  instanceId: z.string().trim().min(1, "Instancia requerida"),
  connectorKey: z.string().trim().min(1).max(100).optional(),
  instrumentId: z.string().trim().min(1).max(200).nullable().optional(),
})

export const pdtpScheduledInstanceOutcomeSchema = z.object({
  instanceId: z.string().trim().min(1, "Instancia requerida"),
  action: z.enum(["submit", "complete", "not_applicable", "cancel"]),
  evidenceRef: z.string().trim().max(2000).nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
  sourceMetadata: z.record(z.string(), z.unknown()).default({}),
})

export const pdtpReminderRuleSchema = z.object({
  offsetValue: z.coerce.number().int().min(-8760).max(8760),
  offsetUnit: z.enum(["hour", "day"]).default("day"),
  recipientKind: z.enum(["responsible", "role", "user"]).default("responsible"),
  recipientUserId: z.string().trim().min(1).nullable().optional(),
  isActive: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (value.recipientKind === "user" && !value.recipientUserId) {
    ctx.addIssue({ code: "custom", path: ["recipientUserId"], message: "Selecciona el destinatario del recordatorio" })
  }
  if (value.recipientKind !== "user" && value.recipientUserId) {
    ctx.addIssue({ code: "custom", path: ["recipientUserId"], message: "El destinatario nominal sólo aplica a reglas por usuario" })
  }
})

function validateScheduleDefinitionMode(
  value: { scheduleMode?: string; scheduleDefinition?: { kind: string } | null },
  ctx: z.RefinementCtx,
) {
  if (!value.scheduleDefinition || !value.scheduleMode) return
  const expected = value.scheduleDefinition.kind === "event"
    ? "triggered"
    : value.scheduleDefinition.kind === "on_demand"
      ? "on_demand"
      : value.scheduleDefinition.kind === "legacy_grid"
        ? undefined
        : "scheduled"
  if (expected && value.scheduleMode !== expected) {
    ctx.addIssue({ code: "custom", path: ["scheduleDefinition"], message: `La programación ${value.scheduleDefinition.kind} no coincide con el modo ${value.scheduleMode}` })
  }
}

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
  scheduleDefinition: pdtpScheduleDefinitionSchema.nullable().optional(),
  executionConfig: pdtpActivityExecutionConfigSchema.optional(),
  reminderRules: z.array(pdtpReminderRuleSchema).max(20).optional(),
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
  validateScheduleDefinitionMode(value, ctx)
})

export const pdtpActivityAddSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  catalogActivityId: z.string().trim().min(1).optional(),
  activity: z.string().trim().min(1).max(4000),
  program: z.string().trim().min(1).max(2000),
  responsibleSlugs: z.array(z.string().min(1)).min(1, "Al menos un responsable"),
  responsibleDisplay: z.string().trim().min(1).max(160),
  audienceRoles: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  scheduleMode: pdtpScheduleModeSchema.default("scheduled"),
  scheduleClassificationStatus: pdtpScheduleClassificationStatusSchema.default("confirmed"),
  recurrenceRule: pdtpRecurrenceRuleSchema.nullable().optional(),
  scheduleDefinition: pdtpScheduleDefinitionSchema.nullable().optional(),
  executionConfig: pdtpActivityExecutionConfigSchema.optional(),
  reminderRules: z.array(pdtpReminderRuleSchema).max(20).optional(),
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
  validateScheduleDefinitionMode(value, ctx)
})

const pdtpProgramActivitySourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("catalog"),
    catalogActivityId: z.string().trim().min(1, "Actividad requerida"),
  }),
  z.object({
    kind: z.literal("new"),
    code: z.string().trim().toUpperCase()
      .regex(/^PDT-[A-Z0-9][A-Z0-9-]{2,116}[A-Z0-9]$/, "Usa el formato PDT-AREA-ACCION"),
    title: z.string().trim().min(3, "El título debe tener al menos 3 caracteres").max(80),
    description: z.string().trim().min(3, "La descripción es obligatoria").max(4000),
    executionGuidance: z.string().trim().min(2, "La guía de ejecución es obligatoria").max(2000),
  }),
])

/** Contrato único del creador. El cliente elige si reutiliza una identidad
 * publicada o crea una nueva; la configuración anual siempre se valida con
 * las mismas reglas modernas de programación, destino, evidencia y avisos. */
export const pdtpProgramActivityCreateSchema = z.object({
  programId: z.string().trim().min(1, "Programa requerido"),
  sheetCode: z.string().trim().min(1).max(100).optional(),
  source: pdtpProgramActivitySourceSchema,
  responsibleSlug: z.string().trim().min(1, "Responsable requerido"),
  audienceRoles: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  scheduleMode: pdtpScheduleModeSchema.default("scheduled"),
  recurrenceRule: pdtpRecurrenceRuleSchema.nullable().optional(),
  scheduleDefinition: pdtpScheduleDefinitionSchema,
  executionConfig: pdtpActivityExecutionConfigSchema,
  reminderRules: z.array(pdtpReminderRuleSchema).max(20).default([]),
  triggerType: z.string().trim().max(100).nullable().optional(),
  triggerDescription: z.string().trim().max(2000).nullable().optional(),
  evidenceRequirement: z.string().trim().max(3000).nullable().optional(),
  notes: z.string().max(5000).optional().or(z.literal("")),
}).superRefine((value, ctx) => {
  if (value.scheduleMode === "scheduled" && !value.recurrenceRule) {
    ctx.addIssue({ code: "custom", path: ["recurrenceRule"], message: "Define una frecuencia para una actividad programada" })
  }
  if (value.scheduleMode === "triggered" && !value.triggerDescription?.trim()) {
    ctx.addIssue({ code: "custom", path: ["triggerDescription"], message: "Describe el evento que genera la obligación" })
  }
  validateScheduleDefinitionMode(value, ctx)
})

const pdtpDeviationKindSchema = z.enum(["not_performed", "not_applicable", "reprogrammed"])

/**
 * `reprogrammed` exige destino completo (mes y semana) y distinto de la
 * celda de origen — espejo exacto de los CHECK
 * `pdtp_execution_deviations_target_check`,
 * `pdtp_execution_deviations_target_both_or_neither_check` y
 * `pdtp_execution_deviations_target_not_same_cell_check`. El resto de los
 * tipos no admite destino: declararlo sería contenido fantasma que la DB
 * de todas formas rechazaría.
 */
export const pdtpDeviationSchema = z.object({
  activityId: z.string().min(1, "Actividad requerida"),
  worksiteId: z.string().min(1, "Faena requerida"),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  week: z.coerce.number().int().min(1).max(4),
  kind: pdtpDeviationKindSchema,
  reason: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(1000),
  targetMonth: z.coerce.number().int().min(1).max(12).optional(),
  targetWeek: z.coerce.number().int().min(1).max(4).optional(),
}).superRefine((value, ctx) => {
  if (value.kind === "reprogrammed") {
    if (value.targetMonth === undefined || value.targetWeek === undefined) {
      ctx.addIssue({ code: "custom", path: ["targetMonth"], message: "El destino (mes y semana) es obligatorio para reprogramar" })
      return
    }
    if (value.targetMonth === value.month && value.targetWeek === value.week) {
      ctx.addIssue({ code: "custom", path: ["targetMonth"], message: "El destino no puede ser la misma celda de origen" })
    }
  } else if (value.targetMonth !== undefined || value.targetWeek !== undefined) {
    ctx.addIssue({ code: "custom", path: ["targetMonth"], message: "El destino solo aplica al reprogramar" })
  }
})

export const pdtpDeviationWithdrawSchema = z.object({
  deviationId: z.string().min(1, "Desvío requerido"),
  reason: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(1000),
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
  /** Objetivo del programa (RE-36) a asignar a la selección; `null` desasigna. */
  objectiveId: z.string().min(1).nullable().optional(),
}).refine((value) => value.responsibleSlugs !== undefined || value.evidenceRequirement !== undefined || value.objectiveId !== undefined, {
  message: "Selecciona al menos un cambio para aplicar",
})

/** Las 8 llaves de `PdtpSchedulePresetKey` (lib/services/pdtp/schedule-presets.ts),
 *  duplicadas aquí a propósito: la validación no importa del servicio (ver el
 *  resto de este archivo, que tampoco importa `PdtpRecurrenceRule`). */
export const pdtpSchedulePresetKeySchema = z.enum([
  "weekly", "daily", "monthly_week", "biweekly_13", "biweekly_24", "quarterly", "campaign", "punctual",
])

const pdtpSchedulePresetCellSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  week: z.coerce.number().int().min(1).max(4),
})

/** Exclusivo de `punctual`; el máximo espeja `MAX_SCHEDULE_CELLS` (12 meses ×
 *  4 semanas). Misma protección contra (mes, semana) duplicados que
 *  `scheduleCellArraySchema` más arriba: dos celdas repetidas producen el
 *  mismo id determinista y una pisa a la otra en silencio. */
const pdtpSchedulePresetCellArraySchema = z.array(pdtpSchedulePresetCellSchema).max(MAX_SCHEDULE_CELLS).superRefine((cells, ctx) => {
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

export const pdtpSchedulePresetParamsSchema = z.object({
  weekOfMonth: z.coerce.number().int().min(1).max(4).optional(),
  // `.positive()`, no `.min(0)`: alineado con `pdtpRecurrenceRuleSchema`, a
  // donde este valor va a parar vía `presetToRule`. Con 0 la proyección lo
  // clampa y las celdas se descartan por no ser positivas — para una
  // actividad de fuente "rule" eso escribía el calendario entero en cero sin
  // que nadie lo confirmara (Ronda de arreglos 1/5, Important 2).
  plannedQuantity: z.coerce.number().positive().max(100000).optional(),
  monthFrom: z.coerce.number().int().min(1).max(12).optional(),
  monthTo: z.coerce.number().int().min(1).max(12).optional(),
  cells: pdtpSchedulePresetCellArraySchema.optional(),
})

export const pdtpSchedulePresetBatchSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  activityIds: z.array(z.string().min(1)).min(1, "Selecciona al menos una actividad").max(200),
  preset: pdtpSchedulePresetKeySchema,
  params: pdtpSchedulePresetParamsSchema.default({}),
  mode: z.enum(["replace", "fill_empty"]),
  /**
   * Ids explícitos que el usuario confirmó reemplazar (ver `n`/actividad que
   * ya vio en pantalla) — no un booleano de lote. Un booleano "confirmar
   * reemplazo" autorizaría a pisar cualquier actividad que se haya vuelto
   * manual entre que el usuario revisó la selección y confirmó, no sólo las
   * que de verdad mostró (Ronda de arreglos 1/5, arreglo barato #2). Sólo
   * los ids de esta lista se eximen de `manual_schedule_would_be_replaced`.
   */
  replaceConfirmedActivityIds: z.array(z.string().min(1)).max(200).optional(),
}).superRefine((value, ctx) => {
  // `punctual` no tiene regla: sus celdas SON el input. Sin esta exigencia,
  // un `punctual` sin `cells` (o con `cells: []`) proyecta cero celdas y
  // `applyPdtpSchedulePresetToActivities` lo trata como
  // `preset_produced_no_cells` — evitable pidiéndolo en el formulario en vez
  // de descubrirlo en el servicio (Ronda de arreglos 1/5, Important 1).
  if (value.preset === "punctual" && !value.params.cells?.length) {
    ctx.addIssue({
      code: "custom",
      path: ["params", "cells"],
      message: "El preset puntual requiere al menos una celda seleccionada",
    })
  }
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

export const pdtpCphsHeadcountSweepSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
})

// ── Plan de Acción → Seguimiento ────────────────────────────────────────────

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
  /*
   * P4 (auditoría 2026-09-14): el checksum del archivo, indexado por su ruta.
   * Lo calcula la ruta de subida sobre el mismo buffer que escribe —es el único
   * punto donde el contenido está en memoria— y llega aquí para que la
   * evidencia de la CAPA cumpla el mismo contrato que la de una inspección.
   *
   * Es un mapa y no un campo dentro de cada foto para no romper la forma de
   * `evidenciaPhotos`, que ya viaja como arreglo de rutas en la UI y en la
   * vista de CAPA.
   */
  evidenciaChecksums: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).optional(),
})

/* ── Cierre mensual por faena (Fase 4, G4) ──────────────────────────────── */

/**
 * Cerrar el mes de un programa en una faena. El motivo tiene el mismo mínimo
 * (10 caracteres) que el resto del módulo y que el CHECK
 * `pdtp_period_closures_close_reason_check`: la regla vive en un solo lugar y
 * la base la respalda.
 *
 * `distribute` no es parte del cierre sino de lo que la acción hace después
 * (mandar la notificación y el correo). Viaja acá porque es una casilla del
 * mismo formulario; el servicio de cierre lo ignora.
 */
export const closePdtpPeriodSchema = z.object({
  programId: z.string().min(1, "Programa requerido"),
  worksiteId: z.string().min(1, "Faena requerida"),
  year: z.coerce.number().int().min(2024).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  reason: z.string().trim().min(10, "El fundamento del cierre debe tener al menos 10 caracteres").max(3000),
  distribute: z.coerce.boolean().optional().default(false),
})

export const reopenPdtpPeriodSchema = z.object({
  closureId: z.string().min(1, "Cierre requerido"),
  reason: z.string().trim().min(10, "El motivo de la reapertura debe tener al menos 10 caracteres").max(3000),
})

export const distributePdtpPeriodClosureSchema = z.object({
  closureId: z.string().min(1, "Cierre requerido"),
})

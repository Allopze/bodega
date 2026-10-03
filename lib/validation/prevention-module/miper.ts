import { z } from "zod"

const id = z.string().min(1)
const version = z.coerce.number().int().positive()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
const scale = z.union([z.literal(1), z.literal(2), z.literal(4)], { message: "Usa Baja (1), Media (2) o Alta (4)." })
const optText = (max: number) => z.string().max(max).nullable().optional()
const headcount = z.coerce.number().int().min(0).max(100_000).nullable()

export const createMiperSchema = z.object({
  worksiteId: id,
  period: z.coerce.number().int().min(2000, "Período inválido").max(2100, "Período inválido"),
  sourceMatrixId: id.nullable().optional(),
  revisionReason: z.string().trim().min(10, "Describe el motivo en al menos 10 caracteres.").max(3000),
})

export const miperHeaderSchema = z.object({
  matrixId: id,
  expectedVersion: version,
  iperCode: z.string().trim().max(60).nullable(),
  elaboratedOn: isoDate.nullable(),
  updatedOn: isoDate.nullable(),
  companyName: z.string().trim().max(300).nullable(),
  companyRut: z.string().trim().max(30).nullable(),
  companyAddress: z.string().trim().max(300).nullable(),
  companyCommune: z.string().trim().max(120).nullable(),
  economicActivity: z.string().trim().max(300).nullable(),
  adherentNumber: z.string().trim().max(60).nullable(),
  worksiteName: z.string().trim().max(300).nullable(),
  siteRepresentativeUserId: id.nullable(),
  siteRepresentativeName: z.string().trim().max(300).nullable(),
  headcountTotal: headcount,
  headcountMale: headcount,
  headcountFemale: headcount,
  headcountOther: headcount,
  participationSummary: z.string().trim().max(5000),
  consultationEvidenceReference: z.string().trim().max(2000),
}).superRefine((value, ctx) => {
  if (value.elaboratedOn && value.updatedOn && value.updatedOn < value.elaboratedOn) {
    ctx.addIssue({ code: "custom", path: ["updatedOn"], message: "La fecha de actualización no puede ser anterior a la de elaboración." })
  }
  const parts = [value.headcountMale, value.headcountFemale, value.headcountOther]
  if (value.headcountTotal !== null && parts.every((part) => part !== null) && parts.reduce<number>((sum, part) => sum + (part ?? 0), 0) !== value.headcountTotal) {
    ctx.addIssue({ code: "custom", path: ["headcountTotal"], message: "Hombres + mujeres + otro debe sumar el total de trabajadores." })
  }
})

export const miperEntryValuesSchema = z.strictObject({
  activity: optText(300),
  task: optText(300),
  position: optText(300),
  location: optText(300),
  exposedFemale: z.coerce.number().int().min(0).max(100_000).optional(),
  exposedMale: z.coerce.number().int().min(0).max(100_000).optional(),
  exposedOther: z.coerce.number().int().min(0).max(100_000).optional(),
  riskFactorId: id.nullable().optional(),
  isRoutine: z.boolean().nullable().optional(),
  hazard: optText(2000),
  risk: optText(2000),
  probableDamage: optText(3000),
  probability: scale.nullable().optional(),
  consequence: scale.nullable().optional(),
  controlledStatus: z.enum(["yes", "partial", "no"]).nullable().optional(),
})

export const miperEntrySaveSchema = z.object({
  matrixId: id,
  entryId: id.optional(),
  expectedVersion: version.optional(),
  insertAfterRowNumber: z.coerce.number().int().min(0).nullable().optional(),
  values: miperEntryValuesSchema,
}).refine((value) => !value.entryId || value.expectedVersion !== undefined, { path: ["expectedVersion"], message: "Falta la versión de la fila; recarga la matriz." })

export const miperEntryRefSchema = z.object({ matrixId: id, entryId: id, expectedVersion: version.optional() })

export const miperControlSaveSchema = z.object({
  matrixId: id,
  entryId: id,
  controlId: id.optional(),
  expectedVersion: version.optional(),
  values: z.object({
    hierarchy: z.enum(["elimination", "substitution", "engineering", "administrative", "ppe"], { message: "Selecciona el tipo de control (I a V)." }),
    description: z.string().trim().min(3, "Describe la medida.").max(3000),
    responsibleUserId: id.nullable().optional(),
    responsibleName: z.string().trim().max(300).nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    /* D5 (Fase C): una medida ya implementada se verifica con una frecuencia y no
     * lleva plazo. Opcionales: sin ellos se conserva lo que la medida ya tenía. */
    isExisting: z.boolean().optional(),
    verificationFrequency: z.string().trim().max(120, "La frecuencia admite hasta 120 caracteres.").nullable().optional(),
  }),
}).refine((value) => !value.controlId || value.expectedVersion !== undefined, { path: ["expectedVersion"], message: "Falta la versión de la medida; recarga la matriz." })

export const miperControlRefSchema = z.object({ matrixId: id, controlId: id, expectedVersion: version })

export const miperWorkflowSchema = z.object({ matrixId: id, expectedVersion: version, comment: z.string().trim().max(3000).optional() })
export const miperCommentedDecisionSchema = miperWorkflowSchema.extend({ comment: z.string().trim().min(10, "Explica la decisión en al menos 10 caracteres.").max(3000) })
export const miperApproveFinalSchema = miperWorkflowSchema.extend({ changeSummary: z.string().trim().min(10, "Resume los cambios de esta versión (hoja Modificaciones).").max(3000) })

export const miperObservationSchema = z.object({ matrixId: id, entryId: id.nullable().optional(), body: z.string().trim().min(5, "La observación debe explicar qué revisar.").max(3000) })
export const miperObservationResponseSchema = z.object({ observationId: id, response: z.string().trim().min(5, "Explica qué corregiste o por qué se mantiene.").max(3000) })
export const miperObservationRefSchema = z.object({ observationId: id })

export const miperDiscardSchema = z.object({ matrixId: id, expectedVersion: version, reason: z.string().trim().min(10, "Indica por qué se descarta el borrador.").max(3000) })

export const riskFactorSaveSchema = z.object({
  id: id.optional(),
  code: z.string().trim().regex(/^[a-z0-9_]+$/, "Usa minúsculas, números y guion bajo.").min(2).max(60),
  name: z.string().trim().min(2).max(120),
  sortOrder: z.coerce.number().int().min(0).max(10_000),
})

/* ── Programa de Trabajo Preventivo RE-04.1 (F2) ──────────────────────────
 * Las validaciones de forma viven acá y las de dominio en el servicio: lo que
 * se puede saber sin mirar la base (fechas, largos, correlativos) se rechaza
 * antes de abrir la transacción. */

const scheduleKind = z.enum(["once", "monthly", "quarterly", "semiannual", "annual"], { message: "Selecciona la frecuencia de la actividad." })
const isoDateRequired = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indica la fecha programada de la actividad.")

/** Encabezado RE-04.1 (§7.1). Mismo contrato de versión que `updateMiperHeader`. */
export const programHeaderSchema = z.object({
  matrixId: id,
  expectedVersion: version,
  elaboratedOn: isoDate.nullable(),
  companyName: z.string().trim().max(300).nullable(),
  companyRut: z.string().trim().max(30).nullable(),
  companyAddress: z.string().trim().max(300).nullable(),
  companyCommune: z.string().trim().max(120).nullable(),
  economicActivity: z.string().trim().max(300).nullable(),
  adherentNumber: z.string().trim().max(60).nullable(),
  worksiteName: z.string().trim().max(300).nullable(),
  siteRepresentativeUserId: id.nullable(),
  siteRepresentativeName: z.string().trim().max(300).nullable(),
  programManagerUserId: id.nullable(),
  headcountTotal: headcount,
  headcountMale: headcount,
  headcountFemale: headcount,
  headcountOther: headcount,
}).superRefine((value, ctx) => {
  const parts = [value.headcountMale, value.headcountFemale, value.headcountOther]
  if (value.headcountTotal !== null && parts.every((part) => part !== null) && parts.reduce<number>((sum, part) => sum + (part ?? 0), 0) !== value.headcountTotal) {
    ctx.addIssue({ code: "custom", path: ["headcountTotal"], message: "Hombres + mujeres + otro debe sumar el total de trabajadores." })
  }
})

/** Actividad del programa: alta (sin `actionId`) y edición (con `expectedVersion`). */
export const programActionSchema = z.object({
  matrixId: id,
  actionId: id.optional(),
  expectedVersion: version.optional(),
  processId: id.nullable().optional(),
  description: z.string().trim().min(3, "Describe la actividad o medida de control.").max(3000),
  responsibleUserId: id.nullable().optional(),
  responsibleName: z.string().trim().max(300).nullable().optional(),
  locationLabel: z.string().trim().max(300).nullable().optional(),
  scheduleKind,
  /* Obligatoria: sin fecha de inicio no hay agenda de ocurrencias (§7.2). */
  startsOn: isoDateRequired,
}).refine((value) => !value.actionId || value.expectedVersion !== undefined, { path: ["expectedVersion"], message: "Falta la versión de la actividad; recarga el programa." })

export const programActionRefSchema = z.object({ actionId: id, expectedVersion: version })

/** Retirar exige motivo: la actividad deja de generar ocurrencias (§7.4). */
export const programActionRetireSchema = programActionRefSchema.extend({
  reason: z.string().trim().min(10, "Explica por qué se retira la actividad (al menos 10 caracteres).").max(3000),
})

/** Vínculo N:M actividad ↔ medida del MIPER (§7.3). */
export const programLinkSchema = z.object({
  programId: id,
  actionId: id,
  controlIds: z.array(id).min(1, "Selecciona al menos una medida del MIPER."),
  link: z.boolean(),
})

export const programUnlinkSchema = z.object({ actionId: id, controlId: id })

export const programProposeSchema = z.object({ matrixId: id })

/** Decisión de la persona sobre una agrupación o medida (§7.3). */
const generationDecisionSchema = z.object({
  controlIds: z.array(id).min(1, "Selecciona al menos una medida."),
  decision: z.enum(["create", "link", "leave"], { message: "Indica qué hacer con la medida." }),
  actionId: id.optional(),
  description: z.string().trim().min(3).max(3000).optional(),
  responsibleUserId: id.nullable().optional(),
  responsibleName: z.string().trim().max(300).nullable().optional(),
  scheduleKind: scheduleKind.optional(),
  startsOn: isoDate.optional(),
  locationLabel: z.string().trim().max(300).nullable().optional(),
})

export const programGenerationSchema = z.object({
  matrixId: id,
  decisions: z.array(generationDecisionSchema).min(1, "No hay decisiones que aplicar.").max(500),
})

/* ── Ejecución de ocurrencias (§7.4) ──────────────────────────────────────
 * `expectedVersion` viaja por compatibilidad con la interfaz del plan: la
 * ocurrencia no tiene columna `version` (no es una fila editable), así que la
 * concurrencia la da el carácter de sólo-inserción de los registros. */

export const occurrenceRecordSchema = z.object({
  occurrenceId: id,
  expectedVersion: version.optional(),
  outcome: z.enum(["done", "not_done"], { message: "Indica si la actividad se hizo o no se hizo." }),
  effectiveOn: isoDate.nullable().optional(),
  reason: z.string().trim().max(3000).nullable().optional(),
  notes: z.string().trim().max(3000).nullable().optional(),
  evidence: z.array(z.object({
    evidenceUploadId: id,
    description: z.string().trim().max(300).nullable().optional(),
  })).max(20).optional(),
})

export const occurrenceRecordRefSchema = z.object({
  recordId: id,
  reason: z.string().trim().min(10, "Explica por qué se anula el registro (al menos 10 caracteres).").max(3000),
})

export const occurrenceEvidenceSchema = z.object({
  recordId: id,
  evidenceUploadId: id,
  description: z.string().trim().max(300).nullable().optional(),
})

export const occurrenceEvidenceRefSchema = z.object({
  evidenceId: id,
  reason: z.string().trim().min(10, "Explica por qué se retira la evidencia (al menos 10 caracteres).").max(3000),
})

/* ── Importación del RE-04 (§9.3, Task 7 de la F3) ────────────────────────
 * La vista previa recibe el archivo por `FormData` (lo lee la acción, no este
 * esquema) y el compromiso identifica el lote ya preparado. Carga a un MIPER en
 * borrador (`draft`, con período y motivo como cualquier alta) o al vigente
 * (`live`, que no crea nada). Nada de esto toca la base. */

export const riskImportTargetSchema = z.enum(["draft", "live"], {
  message: "Indica si la importación crea un borrador o agrega las filas al MIPER vigente.",
})

const riskImportPeriodSchema = z.coerce.number().int().min(2000, "Período inválido").max(2100, "Período inválido").optional()

export const riskImportPreviewSchema = z.object({
  worksiteId: id,
  target: riskImportTargetSchema.default("draft"),
  period: riskImportPeriodSchema,
  /* Sólo para la traza del lote: el archivo se lee en memoria y no se guarda. */
  fileName: z.string().trim().min(1).max(300).optional(),
})

export const riskImportCommitSchema = z.object({
  batchId: id,
  worksiteId: id,
  target: riskImportTargetSchema,
  period: riskImportPeriodSchema,
  /* Sólo para `draft`: es el motivo del alta y queda en la bitácora. */
  revisionReason: z.string().trim().max(3000).optional(),
}).superRefine((value, ctx) => {
  if (value.target !== "draft") return
  const reason = value.revisionReason ?? ""
  if (reason.length > 0 && reason.length < 10) {
    ctx.addIssue({ code: "custom", path: ["revisionReason"], message: "Describe el motivo en al menos 10 caracteres." })
  }
})

export type RiskImportTargetInput = z.infer<typeof riskImportTargetSchema>
export type RiskImportPreviewInput = z.infer<typeof riskImportPreviewSchema>
export type RiskImportCommitInput = z.infer<typeof riskImportCommitSchema>

export type ProgramHeaderInput = z.infer<typeof programHeaderSchema>
export type ProgramActionInput = z.infer<typeof programActionSchema>
export type ProgramGenerationInput = z.infer<typeof programGenerationSchema>
export type OccurrenceRecordInput = z.infer<typeof occurrenceRecordSchema>

export type CreateMiperInput = z.infer<typeof createMiperSchema>
export type MiperHeaderInput = z.infer<typeof miperHeaderSchema>
export type MiperEntryValues = z.infer<typeof miperEntryValuesSchema>
export type MiperEntrySaveInput = z.infer<typeof miperEntrySaveSchema>
export type MiperControlSaveInput = z.infer<typeof miperControlSaveSchema>

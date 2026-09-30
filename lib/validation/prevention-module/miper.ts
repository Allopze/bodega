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

export const miperEntryValuesSchema = z.object({
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
}).strict()

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

export type CreateMiperInput = z.infer<typeof createMiperSchema>
export type MiperHeaderInput = z.infer<typeof miperHeaderSchema>
export type MiperEntryValues = z.infer<typeof miperEntryValuesSchema>
export type MiperEntrySaveInput = z.infer<typeof miperEntrySaveSchema>
export type MiperControlSaveInput = z.infer<typeof miperControlSaveSchema>

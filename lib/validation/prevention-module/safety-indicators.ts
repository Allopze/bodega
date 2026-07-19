import { z } from "zod"

export const safetyIndicatorMonthSchema = z.object({
  worksiteId:          z.string().min(1, "Faena requerida"),
  year:                z.coerce.number().int().min(2024, "El año debe ser al menos 2024").max(2100, "El año no puede superar 2100"),
  month:               z.coerce.number().int().min(1).max(12),
  trabajadores:        z.coerce.number().int().min(0).default(0),
  horasHombre:         z.coerce.number().min(0).default(0),
  accConTiempoPerdido: z.coerce.number().int().min(0).default(0),
  accSinTiempoPerdido: z.coerce.number().int().min(0).default(0),
  diasPerdidos:        z.coerce.number().int().min(0).default(0),
  incidentes:          z.coerce.number().int().min(0).default(0),
  danoMaterial:        z.coerce.number().int().min(0).default(0),
  danoAmbiental:       z.coerce.number().int().min(0).default(0),
  correctionReason:    z.string().trim().min(10).max(3000).nullable().optional(),
})

export type SafetyIndicatorMonthInput = z.infer<typeof safetyIndicatorMonthSchema>

export const safetyIndicatorDenominatorSchema = z.object({
  worksiteId: z.string().min(1, "Faena requerida"),
  year: z.coerce.number().int().min(2024).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  workerCount: z.coerce.number().int().min(0),
  workedHours: z.coerce.number().min(0),
  sourceType: z.enum(["rrhh", "xlsx_import", "manual", "other_system"]),
  sourceReference: z.string().trim().min(3).max(1000),
  evidenceReference: z.string().trim().min(3).max(4000),
  evidenceChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  reconciliationStatus: z.enum(["pending", "matched", "difference", "exception"]),
  reconciliationNotes: z.string().trim().min(5).max(4000).nullable().optional(),
  submitForReview: z.boolean().default(false),
  expectedVersion: z.number().int().positive().nullable().optional(),
  correctionReason: z.string().trim().min(10).max(3000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.reconciliationStatus !== "matched" && !value.reconciliationNotes) {
    ctx.addIssue({ code: "custom", path: ["reconciliationNotes"], message: "Documenta la diferencia o excepción." })
  }
})

export const approveSafetyIndicatorDenominatorSchema = z.object({
  denominatorId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(10).max(3000),
})

export const closeSafetyIndicatorPeriodSchema = z.object({
  worksiteId: z.string().min(1),
  year: z.coerce.number().int().min(2024).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  reason: z.string().trim().min(10).max(3000),
})

export type SafetyIndicatorDenominatorInput = z.infer<typeof safetyIndicatorDenominatorSchema>

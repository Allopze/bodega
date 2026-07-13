import { z } from "zod"

const nullableText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""))

export const taeEvidenceKinds = ["odometer", "liter_meter", "removed_seal", "installed_seal"] as const

export const taePublicSubmissionSchema = z.object({
  clientSubmissionId: z.string().trim().min(12).max(100),
  worksiteId: z.string().trim().min(1),
  loadingPointId: z.string().trim().min(1, "El QR debe identificar un punto de carga"),
  vehicleId: z.string().trim().min(1, "Selecciona el equipo"),
  equipmentCode: z.string().trim().min(2, "Selecciona el equipo").max(120),
  plate: nullableText(30),
  loadedAt: z.string().datetime({ offset: true }),
  driverWorkerId: z.string().trim().min(1).optional().or(z.literal("")),
  driverName: z.string().trim().min(2, "Indica el conductor").max(120),
  supervisorWorkerId: z.string().trim().min(1).optional().or(z.literal("")),
  supervisorName: z.string().trim().min(2, "Indica el supervisor o líder").max(120),
  manualIdentity: z.boolean().default(false),
  meterType: z.enum(["odometer", "hour_meter"]),
  meterReading: z.number().nonnegative().optional().nullable(),
  meterUnavailableReason: nullableText(250),
  liters: z.number().positive("Los litros deben ser mayores que cero").max(2000),
  removedSealNumber: nullableText(80),
  installedSealNumber: nullableText(80),
  noSealReason: nullableText(250),
  notes: nullableText(1000),
}).superRefine((value, ctx) => {
  if ((!value.removedSealNumber || !value.installedSealNumber) && !(value.noSealReason ?? "").trim()) {
    ctx.addIssue({ code: "custom", path: ["noSealReason"], message: "Indica el motivo cuando falta un sello" })
  }
})

export type TaePublicSubmissionInput = z.infer<typeof taePublicSubmissionSchema>

export const taeSubmissionStatusSchema = z.enum(["submitted", "observed", "validated", "voided"])
export type TaeSubmissionStatus = z.infer<typeof taeSubmissionStatusSchema>

const TAE_REVIEW_TRANSITIONS: Record<TaeSubmissionStatus, readonly TaeSubmissionStatus[]> = {
  submitted: ["observed", "validated", "voided"],
  observed: ["validated", "voided"],
  validated: ["observed", "voided"],
  voided: [],
}

export function isTaeReviewTransitionAllowed(from: TaeSubmissionStatus, to: TaeSubmissionStatus) {
  return TAE_REVIEW_TRANSITIONS[from].includes(to)
}

export const taeReviewSchema = z.object({
  id: z.string().min(1),
  expectedStatus: taeSubmissionStatusSchema,
  status: z.enum(["observed", "validated", "voided"]),
  reviewNote: z.string().trim().min(4, "Indica el motivo o resolución").max(1000),
})

export const taeMeterCorrectionSchema = z.object({
  id: z.string().min(1),
  expectedStatus: taeSubmissionStatusSchema,
  meterReading: z.number().finite().nonnegative("La lectura debe ser mayor o igual a cero").max(9_999_999),
  meterType: z.enum(["odometer", "hour_meter"]),
  reason: z.string().trim().min(4, "Indica el motivo de la corrección").max(1000),
})

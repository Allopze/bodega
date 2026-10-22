import { z } from "zod"

const nullableText = (max: number) => z.string().trim().max(max, `Usa como máximo ${max} caracteres`).optional().or(z.literal(""))

/** Tope de una lectura de odómetro u horómetro. Exportado para que el formulario avise antes de enviar. */
export const METER_READING_MAX = 9_999_999
const METER_READING_MAX_MESSAGE = "La lectura no puede superar 9.999.999. Revisa que no tenga dígitos de más."

export const taeEvidenceKinds = ["odometer", "liter_meter", "removed_seal", "installed_seal"] as const

export type TaeEvidenceKind = (typeof taeEvidenceKinds)[number]

/** Fotos que siempre se exigen; las de sello solo si se informa el número de ese sello (D-9). */
export const TAE_ALWAYS_REQUIRED_EVIDENCE: readonly TaeEvidenceKind[] = ["odometer", "liter_meter"]

/**
 * Carga en terreno. La hora NO viaja como dato confiable: en línea la sella el
 * servidor; solo un envío repetido desde la cola sin conexión (`offline: true`)
 * trae `capturedAt`, la hora del dispositivo al encolar (S-5).
 *
 * Las reglas de negocio (lectura menor, capacidad, sellos de relleno, motivo
 * sin sello) no viven aquí sino en `field-load-rules.ts` y en el servicio, para
 * que respondan 422 con un mensaje para el operador y no un 400 genérico.
 */
export const taePublicSubmissionSchema = z.object({
  clientSubmissionId: z.string().trim().min(12).max(100),
  worksiteId: z.string().trim().min(1),
  loadingPointId: z.string().trim().min(1, "Falta el lugar de carga"),
  vehicleId: z.string().trim().min(1, "Selecciona el equipo"),
  productId: z.string().trim().min(1, "Selecciona el producto"),
  supplyMediumId: z.string().trim().min(1, "Indica con qué medio se cargó el combustible"),
  equipmentCode: z.string().trim().min(2, "Selecciona el equipo").max(120),
  plate: nullableText(30),
  capturedAt: z.string().datetime({ offset: true }).optional().nullable(),
  offline: z.boolean().optional().default(false),
  driverWorkerId: z.string().trim().min(1).optional().or(z.literal("")),
  driverName: z.string().trim().min(2, "Indica el conductor").max(120),
  supervisorWorkerId: z.string().trim().min(1).optional().or(z.literal("")),
  supervisorName: z.string().trim().min(2, "Indica el supervisor o líder").max(120),
  manualIdentity: z.boolean().default(false),
  meterType: z.enum(["odometer", "hour_meter"]),
  meterReading: z.number().finite("Escribe la lectura como número").nonnegative("La lectura no puede ser negativa").max(METER_READING_MAX, METER_READING_MAX_MESSAGE).optional().nullable(),
  meterUnavailableReason: nullableText(250),
  liters: z.number().finite("Escribe los litros como número").positive("Los litros deben ser mayores que cero"),
  removedSealNumber: nullableText(80),
  installedSealNumber: nullableText(80),
  noSealReason: nullableText(250),
  notes: nullableText(1000),
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
  /** Cambio de tablero o de equipo: la lectura inicia una serie nueva (S-6). */
  meterReset: z.boolean().optional().default(false),
  expectedStatus: taeSubmissionStatusSchema,
  meterReading: z.number().finite("Escribe la lectura como número").nonnegative("La lectura debe ser mayor o igual a cero").max(METER_READING_MAX, METER_READING_MAX_MESSAGE),
  meterType: z.enum(["odometer", "hour_meter"]),
  reason: z.string().trim().min(4, "Indica el motivo de la corrección").max(1000),
})

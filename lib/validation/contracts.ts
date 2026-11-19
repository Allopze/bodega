import { z } from "zod"
import { civilDate } from "@/lib/validation/dates"

/**
 * Validación de los contratos de una faena y de la asignación de equipos.
 *
 * Aquí viven sólo los esquemas de asignación (Task 3). Task 5 agrega debajo los
 * de contrato y mandante, para que todo lo de contratos quede en un archivo.
 */

/** Motivo opcional de ≤ 300 caracteres (coincide con el CHECK de la tabla); vacío = sin motivo. */
const optionalReason = z
  .string()
  .trim()
  .max(300, "El motivo admite hasta 300 caracteres")
  .optional()
  .transform((value) => (value ? value : undefined))

/** Asignar uno o varios equipos a un contrato desde un día (inclusive). */
export const contractAssignmentSchema = z.object({
  contractId: z.string().trim().min(1, "Elige un contrato"),
  vehicleIds: z.array(z.string().trim().min(1)).min(1, "Elige al menos un equipo").max(200, "Hasta 200 equipos por vez"),
  validFrom: civilDate("Indica desde qué día"),
  reason: optionalReason,
})

/** Quitar un equipo de su contrato; `lastDay` es el último día que cuenta (inclusive). */
export const endAssignmentSchema = z.object({
  vehicleId: z.string().trim().min(1, "Elige un equipo"),
  lastDay: civilDate("Indica el último día"),
  reason: optionalReason,
})

export type ContractAssignmentInput = z.infer<typeof contractAssignmentSchema>
export type EndAssignmentInput = z.infer<typeof endAssignmentSchema>

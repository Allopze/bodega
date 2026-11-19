import { z } from "zod"
import { civilDate } from "@/lib/validation/dates"

/**
 * Validación de los contratos de una faena, de los mandantes y de la asignación
 * de equipos. Todo lo de contratos queda en este archivo.
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

/** Fecha civil opcional: vacío o nulo = sin fecha. */
const optionalCivilDate = (message: string) =>
  z.preprocess((value) => (value === "" || value === null ? undefined : value), civilDate(message).optional())

/**
 * Contrato operativo (el que se crea y edita desde la faena). Sólo lleva lo que
 * la operación necesita; los campos de cobro siguen siendo de Facturación.
 */
export const operationalContractSchema = z.object({
  id: z.string().trim().min(1).optional(),
  worksiteId: z.string().trim().min(1, "Elige la faena"),
  clientId: z.string().trim().min(1, "Elige el mandante"),
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres").max(120, "El nombre admite hasta 120 caracteres"),
  startDate: optionalCivilDate("Indica una fecha de inicio válida"),
  endDate: optionalCivilDate("Indica una fecha de término válida"),
  status: z.enum(["active", "suspended", "closed"]),
}).refine((data) => !data.startDate || !data.endDate || data.startDate <= data.endDate, {
  path: ["endDate"],
  message: "La fecha de término no puede ser anterior al inicio",
})

/** Mandante nuevo: el cliente para el que se presta el servicio. */
export const mandanteSchema = z.object({
  rut: z.string().trim().min(1, "Indica el RUT"),
  name: z.string().trim().min(2, "La razón social debe tener al menos 2 caracteres").max(160, "La razón social admite hasta 160 caracteres"),
})

export type ContractAssignmentInput = z.infer<typeof contractAssignmentSchema>
export type EndAssignmentInput = z.infer<typeof endAssignmentSchema>
export type OperationalContractInput = z.infer<typeof operationalContractSchema>
export type MandanteInput = z.infer<typeof mandanteSchema>

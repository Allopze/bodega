import { z } from "zod"
import { civilDate } from "./dates"

const optionalText = z.string().trim().optional().transform((value) => value || null)

export { civilDate } from "./dates"
const optionalNumber = z.coerce.number().min(0).optional().nullable()

export const MAINTENANCE_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number]
export const MAINTENANCE_INITIAL_STATUSES = ["scheduled", "in_progress"] as const
export const MAINTENANCE_TRANSITIONS = ["start", "complete", "reopen", "cancel"] as const
export type MaintenanceTransition = (typeof MAINTENANCE_TRANSITIONS)[number]

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  scheduled: "Programada",
  in_progress: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
}

const maintenanceEditableShape = {
  vehicleId: z.string().min(1, "Vehículo requerido"),
  supplierId: optionalText,
  // Sin `worksiteId`: la faena de la mantención es la del vehículo y se resuelve
  // en el servidor. Aceptarla desde el formulario dividía los agregados.
  costCenterId: optionalText,
  // Formato **y** existencia: el string llega a SQL crudo sin castear
  // (`${m.maintenanceDate}::date` en lib/services/fleet.ts). La regex sola deja
  // pasar 2026-02-31 y 2026-13-01, que revientan esa consulta para todo el
  // vehículo — el error no aparece al guardar sino al abrir la ficha.
  maintenanceDate: civilDate("Fecha inválida"),
  maintenanceType: z.string().min(1, "Tipo requerido").max(80),
  odometerReading: optionalNumber,
  hourMeterReading: optionalNumber,
  netAmount: z.coerce.number().min(0, "Neto debe ser ≥ 0"),
  taxAmount: z.coerce.number().min(0, "IVA debe ser ≥ 0"),
  totalAmount: z.coerce.number().min(0, "Total debe ser ≥ 0"),
  documentNumber: optionalText,
  documentName: optionalText,
  notes: optionalText,
}

const totalMatchesNetPlusTax = (data: { totalAmount: number; netAmount: number; taxAmount: number }) =>
  Math.abs(data.totalAmount - (data.netAmount + data.taxAmount)) <= 1
const totalRefineOpts = { message: "El total debe ser igual a neto + IVA", path: ["totalAmount"] }

export const createMaintenanceRecordSchema = z
  .object({ ...maintenanceEditableShape, status: z.enum(MAINTENANCE_INITIAL_STATUSES) })
  .refine(totalMatchesNetPlusTax, totalRefineOpts)

export const updateMaintenanceRecordSchema = z
  .object({ id: z.string().min(1, "ID requerido"), ...maintenanceEditableShape })
  .refine(totalMatchesNetPlusTax, totalRefineOpts)

export const transitionMaintenanceRecordSchema = z.object({
  id: z.string().min(1, "ID requerido"),
  expectedStatus: z.enum(MAINTENANCE_STATUSES),
  transition: z.enum(MAINTENANCE_TRANSITIONS),
  reason: z.string().trim().min(5, "Indica un motivo de al menos 5 caracteres").max(500),
})

export type CreateMaintenanceRecordInput = z.infer<typeof createMaintenanceRecordSchema>
export type UpdateMaintenanceRecordInput = z.infer<typeof updateMaintenanceRecordSchema>
export type TransitionMaintenanceRecordInput = z.infer<typeof transitionMaintenanceRecordSchema>

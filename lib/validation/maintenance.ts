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
export const MAINTENANCE_PRIORITIES = ["low", "normal", "high", "critical"] as const
export const MAINTENANCE_OPERATIONAL_IMPACTS = ["none", "maintenance", "out_of_service"] as const
export const MAINTENANCE_PLAN_STRATEGIES = ["calendar", "odometer", "hour_meter", "combined"] as const
export const MAINTENANCE_DOCUMENT_TYPES = ["quote", "diagnosis", "work_order", "invoice", "evidence", "other"] as const

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  scheduled: "Programada",
  in_progress: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
}

export type MaintenanceStatusVariant = "default" | "warning" | "success" | "danger" | "outline"
// Igual a `StateMetaInput["variant"]` en los valores que el módulo usa; se
// mantiene literal para que el schema de validación no dependa de UI.

/** Variant de presentación canónico (2026-08-25): `cancelled` es `danger`, no
 *  `default` — la anulación es un estado terminal negativo. La ficha de flota
 *  lo pintaba gris mientras las otras dos pantallas usaban rojo. */
export const MAINTENANCE_STATUS_VARIANTS: Record<MaintenanceStatus, MaintenanceStatusVariant> = {
  scheduled: "outline",
  in_progress: "warning",
  completed: "success",
  cancelled: "danger",
}

export function maintenanceStatusMeta(status: string): { label: string; variant: MaintenanceStatusVariant } {
  if (Object.prototype.hasOwnProperty.call(MAINTENANCE_STATUS_LABELS, status)) {
    const typedStatus = status as MaintenanceStatus
    return {
      label: MAINTENANCE_STATUS_LABELS[typedStatus],
      variant: MAINTENANCE_STATUS_VARIANTS[typedStatus],
    }
  }

  return { label: status, variant: "outline" }
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
  priority: z.enum(MAINTENANCE_PRIORITIES).optional().default("normal"),
  assignedToUserId: optionalText,
  slaDueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  rootCause: optionalText,
  underWarranty: z.coerce.boolean().optional().default(false),
  operationalImpact: z.enum(MAINTENANCE_OPERATIONAL_IMPACTS).optional().default("maintenance"),
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

export const maintenancePlanSchema = z.object({
  id: z.string().min(1).optional(),
  vehicleId: z.string().min(1, "Vehículo requerido"),
  name: z.string().trim().min(3).max(160),
  maintenanceType: z.string().trim().min(1).max(80),
  strategy: z.enum(MAINTENANCE_PLAN_STRATEGIES),
  intervalDays: z.coerce.number().int().positive().max(3650).nullable().optional(),
  intervalUnits: z.coerce.number().positive().max(10_000_000).nullable().optional(),
  advanceDays: z.coerce.number().int().min(0).max(365).default(7),
  advanceUnits: z.coerce.number().min(0).max(1_000_000).default(100),
  nextDueDate: civilDate("Próxima fecha inválida").nullable().optional(),
  nextDueReading: z.coerce.number().min(0).nullable().optional(),
  assignedToUserId: optionalText,
  supplierId: optionalText,
  costCenterId: optionalText,
  instructions: optionalText,
}).superRefine((data, ctx) => {
  if (["calendar", "combined"].includes(data.strategy) && !data.intervalDays) {
    ctx.addIssue({ code: "custom", path: ["intervalDays"], message: "Indica el intervalo en días" })
  }
  if (["odometer", "hour_meter", "combined"].includes(data.strategy) && !data.intervalUnits) {
    ctx.addIssue({ code: "custom", path: ["intervalUnits"], message: "Indica el intervalo de uso" })
  }
})

export const maintenanceTaskSchema = z.object({
  maintenanceId: z.string().min(1),
  description: z.string().trim().min(3).max(500),
})

export const maintenancePartSchema = z.object({
  maintenanceId: z.string().min(1),
  description: z.string().trim().min(2).max(300),
  partNumber: optionalText,
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().min(1).max(30).default("un"),
  unitCost: z.coerce.number().min(0).default(0),
})

export const maintenanceDocumentMetadataSchema = z.object({
  maintenanceId: z.string().min(1, "Orden requerida"),
  documentType: z.enum(MAINTENANCE_DOCUMENT_TYPES),
})

export const maintenanceLaborSchema = z.object({
  maintenanceId: z.string().min(1),
  description: z.string().trim().min(2).max(300),
  hours: z.coerce.number().positive().max(10_000),
  hourlyRate: z.coerce.number().min(0).max(1_000_000_000).default(0),
})

export const maintenanceCostApprovalSchema = z.object({
  maintenanceId: z.string().min(1),
  decision: z.enum(["request", "approve", "reject"]),
})

export const maintenanceDocumentPolicySchema = z.object({
  equipmentTypeId: z.string().min(1, "Clase de activo requerida"),
  documentType: z.enum(MAINTENANCE_DOCUMENT_TYPES),
  requiredAt: z.enum(["before_start", "before_complete"]),
})

export type CreateMaintenanceRecordInput = z.infer<typeof createMaintenanceRecordSchema>
export type UpdateMaintenanceRecordInput = z.infer<typeof updateMaintenanceRecordSchema>
export type TransitionMaintenanceRecordInput = z.infer<typeof transitionMaintenanceRecordSchema>
export type MaintenancePlanInput = z.infer<typeof maintenancePlanSchema>
export type MaintenanceTaskInput = z.infer<typeof maintenanceTaskSchema>
export type MaintenancePartInput = z.infer<typeof maintenancePartSchema>
export type MaintenanceLaborInput = z.infer<typeof maintenanceLaborSchema>

import { z } from "zod"

const optionalText = z.string().trim().optional().transform((value) => value || null)
const optionalNumber = z.coerce.number().min(0).optional().nullable()

const maintenanceBaseShape = {
  vehicleId: z.string().min(1, "Vehículo requerido"),
  supplierId: optionalText,
  worksiteId: optionalText,
  costCenterId: optionalText,
  maintenanceDate: z.string().min(1, "Fecha requerida"),
  maintenanceType: z.string().min(1, "Tipo requerido").max(80),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]),
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
  .object(maintenanceBaseShape)
  .refine(totalMatchesNetPlusTax, totalRefineOpts)

export const updateMaintenanceRecordSchema = z
  .object({ id: z.string().min(1, "ID requerido"), ...maintenanceBaseShape })
  .refine(totalMatchesNetPlusTax, totalRefineOpts)

export type CreateMaintenanceRecordInput = z.infer<typeof createMaintenanceRecordSchema>
export type UpdateMaintenanceRecordInput = z.infer<typeof updateMaintenanceRecordSchema>

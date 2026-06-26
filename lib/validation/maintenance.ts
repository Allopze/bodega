import { z } from "zod"

const optionalText = z.string().trim().optional().transform((value) => value || null)
const optionalNumber = z.coerce.number().min(0).optional().nullable()

export const createMaintenanceRecordSchema = z.object({
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
})

export type CreateMaintenanceRecordInput = z.infer<typeof createMaintenanceRecordSchema>

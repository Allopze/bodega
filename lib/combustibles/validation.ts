import { z } from "zod"

/* ── Fuel Load ───────────────────────────────────────────────────────────── */
export const createFuelLoadSchema = z.object({
  loadDate:       z.string().min(1, "Fecha requerida"),
  month:          z.string().min(1, "Mes requerido"),       // "2026-01"
  serviceType:    z.enum(["TCT", "TAE"]),
  vehicleId:      z.string().min(1, "Vehículo requerido"),
  fuelSupplierId: z.string().min(1, "Proveedor requerido"),
  worksiteId:     z.string().min(1, "Faena requerida"),
  product:        z.string().min(1, "Producto requerido"),
  receiptNumber:  z.string().optional(),
  odometerReading: z.coerce.number().min(0, "Kilometraje debe ser ≥ 0").optional().nullable(),
  hourMeterReading: z.coerce.number().min(0, "Horómetro debe ser ≥ 0").optional().nullable(),
  liters:         z.coerce.number().min(0, "Litros debe ser ≥ 0"),
  iecFixed:       z.coerce.number().default(0),
  iecVariable:    z.coerce.number().default(0),
  baseAmount:     z.coerce.number().min(0, "Base afecta requerida"),
  iecTotal:       z.coerce.number().default(0),
  ivaAmount:      z.coerce.number().default(0),
  totalAmount:    z.coerce.number().min(0, "Total requerido"),
  notes:          z.string().optional(),
})

export const updateFuelLoadSchema = createFuelLoadSchema.partial().extend({
  id: z.string().min(1),
})

export type CreateFuelLoadInput = z.infer<typeof createFuelLoadSchema>
export type UpdateFuelLoadInput = z.infer<typeof updateFuelLoadSchema>

/* ── Fuel Vehicle ────────────────────────────────────────────────────────── */
export const createFuelVehicleSchema = z.object({
  plate:     z.string().min(1, "Patente requerida").max(20),
  type:      z.enum(["camion", "camioneta", "estanque"]),
  brand:     z.string().max(100).optional(),
  model:     z.string().max(100).optional(),
  year:      z.coerce.number().int().min(1990).max(2030).optional(),
  worksiteId: z.string().min(1, "Faena requerida"),
  notes:     z.string().optional(),
})

export const updateFuelVehicleSchema = createFuelVehicleSchema.partial().extend({
  id: z.string().min(1),
})

export type CreateFuelVehicleInput = z.infer<typeof createFuelVehicleSchema>
export type UpdateFuelVehicleInput = z.infer<typeof updateFuelVehicleSchema>

/* ── Fuel Supplier ───────────────────────────────────────────────────────── */
export const createFuelSupplierSchema = z.object({
  name:         z.string().min(1, "Nombre requerido").max(200),
  rut:          z.string().max(20).optional(),
  contactName:  z.string().max(200).optional(),
  contactPhone: z.string().max(30).optional(),
  contactEmail: z.string().email().max(200).optional().or(z.literal("")),
  notes:        z.string().optional(),
})

export const updateFuelSupplierSchema = createFuelSupplierSchema.partial().extend({
  id: z.string().min(1),
})

export type CreateFuelSupplierInput = z.infer<typeof createFuelSupplierSchema>
export type UpdateFuelSupplierInput = z.infer<typeof updateFuelSupplierSchema>

/* ── Monthly Statement ───────────────────────────────────────────────────── */
export const createMonthlyStatementSchema = z.object({
  month:          z.string().min(1, "Mes requerido"),       // "2026-01"
  fuelSupplierId: z.string().min(1, "Proveedor requerido"),
  dueDate:        z.string().optional(),
  notes:          z.string().optional(),
})

export const addPaymentSchema = z.object({
  statementId:   z.string().min(1),
  paymentDate:   z.string().min(1, "Fecha de pago requerida"),
  amount:        z.coerce.number().positive("Monto debe ser > 0"),
  paymentMethod: z.string().optional(),
  reference:     z.string().optional(),
  notes:         z.string().optional(),
})

export type CreateMonthlyStatementInput = z.infer<typeof createMonthlyStatementSchema>
export type AddPaymentInput = z.infer<typeof addPaymentSchema>

/* ── Import ──────────────────────────────────────────────────────────────── */
export const importFiltersSchema = z.object({
  month:    z.string().optional(),
  supplier: z.string().optional(),
})

export type ImportFilters = z.infer<typeof importFiltersSchema>

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
  baseAmount:     z.coerce.number().positive("Base afecta debe ser > 0"),
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
// Tipos sugeridos en los dropdowns. `type` NO es un enum estricto en la BD:
// el catálogo real ya tiene ~17 valores libres sembrados ("maquina industrial",
// "tractocamion", "remolque", "casa rodante", etc.) que no calzan con esta
// lista. Validar como enum rechazaría esos valores al editar un vehículo
// legacy, por eso `type` se valida como string (ver createFuelVehicleSchema);
// esta lista solo alimenta los <Select> como opciones canónicas.
export const FUEL_VEHICLE_TYPES = [
  "camion", "camioneta", "estanque",
  "cargador", "tractor", "excavadora", "bulldozer", "minicargador",
  "retroexcavadora", "hidrolavadora", "tracto", "station_wagon", "camion_3_4",
] as const

export const FUEL_VEHICLE_TYPE_LABELS: Record<(typeof FUEL_VEHICLE_TYPES)[number], string> = {
  camion: "Camión",
  camioneta: "Camioneta",
  estanque: "Estanque",
  cargador: "Cargador",
  tractor: "Tractor",
  excavadora: "Excavadora",
  bulldozer: "Bulldozer",
  minicargador: "Minicargador",
  retroexcavadora: "Retroexcavadora",
  hidrolavadora: "Hidrolavadora",
  tracto: "Tracto",
  station_wagon: "Station wagon",
  camion_3_4: "Camión 3/4",
}

/** Safe aliases for values already found in legacy vehicle records. */
export const FUEL_VEHICLE_TYPE_ALIASES: Record<string, (typeof FUEL_VEHICLE_TYPES)[number]> = {
  "camion 3/4": "camion_3_4",
  "mini cargador": "minicargador",
  "retro excavadora": "retroexcavadora",
  "hidro lavadora": "hidrolavadora",
  tractocamion: "tracto",
  "station wagon": "station_wagon",
}

export const FUEL_EQUIPMENT_TYPE_ID_BY_SLUG: Record<(typeof FUEL_VEHICLE_TYPES)[number], string> = {
  camion: "fet-camion",
  camioneta: "fet-camioneta",
  estanque: "fet-estanque",
  cargador: "fet-cargador",
  tractor: "fet-tractor",
  excavadora: "fet-excavadora",
  bulldozer: "fet-bulldozer",
  minicargador: "fet-minicargador",
  retroexcavadora: "fet-retroexcavadora",
  hidrolavadora: "fet-hidrolavadora",
  tracto: "fet-tracto",
  station_wagon: "fet-station-wagon",
  camion_3_4: "fet-camion-3-4",
}

function normalizeVehicleType(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es-CL").replace(/\s+/g, " ")
}

export function fuelEquipmentTypeSlug(value: string) {
  const canonical = canonicalFuelVehicleType(value)
  if (canonical) return canonical
  return normalizeVehicleType(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "otro"
}

export function canonicalFuelVehicleType(value: string) {
  const normalized = normalizeVehicleType(value)
  if (FUEL_VEHICLE_TYPES.includes(normalized as (typeof FUEL_VEHICLE_TYPES)[number])) return normalized as (typeof FUEL_VEHICLE_TYPES)[number]
  return FUEL_VEHICLE_TYPE_ALIASES[normalized] ?? null
}

export function fuelEquipmentTypeIdForLegacy(value: string) {
  const canonical = canonicalFuelVehicleType(value)
  return canonical ? FUEL_EQUIPMENT_TYPE_ID_BY_SLUG[canonical] : "fet-other"
}

export function fuelMetricDefaultsForLegacy(value: string): { meterType: (typeof FUEL_METER_TYPES)[number]; performanceUnit: (typeof FUEL_PERFORMANCE_UNITS)[number] } {
  const canonical = canonicalFuelVehicleType(value)
  if (canonical && ["camion", "camioneta", "tracto", "station_wagon", "camion_3_4"].includes(canonical)) {
    return { meterType: "odometer", performanceUnit: "km_per_liter" }
  }
  if (canonical && ["cargador", "tractor", "excavadora", "bulldozer", "minicargador", "retroexcavadora"].includes(canonical)) {
    return { meterType: "hour_meter", performanceUnit: "liters_per_hour" }
  }
  return { meterType: "none", performanceUnit: "not_applicable" }
}

export function formatFuelVehicleType(value: string) {
  const canonical = canonicalFuelVehicleType(value)
  if (!canonical) return value
  const label = FUEL_VEHICLE_TYPE_LABELS[canonical]
  return value === canonical ? label : `${value} · ${label}`
}

export const FUEL_VEHICLE_STATUSES = ["operativo", "mantencion", "fuera_servicio"] as const

export const FUEL_EQUIPMENT_CATEGORIES = ["truck", "light", "heavy", "storage", "support", "other"] as const
export const FUEL_EQUIPMENT_CATEGORY_LABELS: Record<(typeof FUEL_EQUIPMENT_CATEGORIES)[number], string> = {
  truck: "Camiones y tractocamiones",
  light: "Vehículos livianos",
  heavy: "Maquinaria pesada",
  storage: "Estanques y almacenamiento",
  support: "Equipos de apoyo",
  other: "Otros",
}

export const FUEL_METER_TYPES = ["odometer", "hour_meter", "none"] as const
export const FUEL_METER_TYPE_LABELS: Record<(typeof FUEL_METER_TYPES)[number], string> = {
  odometer: "Odómetro",
  hour_meter: "Horómetro",
  none: "Sin medidor",
}

export const FUEL_PERFORMANCE_UNITS = ["km_per_liter", "liters_per_hour", "not_applicable"] as const
export const FUEL_PERFORMANCE_UNIT_LABELS: Record<(typeof FUEL_PERFORMANCE_UNITS)[number], string> = {
  km_per_liter: "km/L",
  liters_per_hour: "L/h",
  not_applicable: "No aplica",
}

export const FUEL_PRODUCT_CATEGORIES = ["diesel", "additive", "gasoline", "other"] as const
export const FUEL_PRODUCT_CATEGORY_LABELS: Record<(typeof FUEL_PRODUCT_CATEGORIES)[number], string> = {
  diesel: "Diésel",
  additive: "Aditivo",
  gasoline: "Gasolina",
  other: "Otro",
}
export const FUEL_PRODUCT_UNITS = ["liter", "kilogram", "unit"] as const
export const FUEL_PRODUCT_UNIT_LABELS: Record<(typeof FUEL_PRODUCT_UNITS)[number], string> = {
  liter: "Litro",
  kilogram: "Kilogramo",
  unit: "Unidad",
}

export const fuelProductSchema = z.object({
  code: z.string().trim().min(2, "Código requerido").max(40).regex(/^[A-Za-z0-9_-]+$/, "Usa letras, números, guion o guion bajo"),
  name: z.string().trim().min(2, "Nombre requerido").max(100),
  category: z.enum(FUEL_PRODUCT_CATEGORIES),
  unit: z.enum(FUEL_PRODUCT_UNITS),
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  description: z.string().trim().max(500).optional(),
})

export const FUEL_VEHICLE_STATUS_LABELS: Record<(typeof FUEL_VEHICLE_STATUSES)[number], string> = {
  operativo: "Operativo",
  mantencion: "En mantención",
  fuera_servicio: "Fuera de servicio",
}

export const fuelEquipmentTypeSchema = z.object({
  name: z.string().trim().min(2, "Nombre requerido").max(100),
  category: z.enum(FUEL_EQUIPMENT_CATEGORIES),
  defaultMeterType: z.enum(FUEL_METER_TYPES),
  defaultPerformanceUnit: z.enum(FUEL_PERFORMANCE_UNITS),
  description: z.string().trim().max(500).optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
}).superRefine((value, ctx) => {
  validateMeterPerformancePair(value.defaultMeterType, value.defaultPerformanceUnit, ctx)
})

const fuelVehicleBaseSchema = z.object({
  plate:     z.string().min(1, "Patente requerida").max(20),
  equipmentTypeId: z.string().min(1, "Tipo requerido"),
  type:      z.string().max(100).optional(), // snapshot derivado en servidor; compatibilidad para importadores legacy
  meterType: z.enum(FUEL_METER_TYPES),
  performanceUnit: z.enum(FUEL_PERFORMANCE_UNITS),
  tankCapacityLiters: z.coerce.number().positive("La capacidad debe ser mayor que cero").max(1_000_000).optional(),
  comparisonGroup: z.string().trim().max(100).optional(),
  usualFuelSupplierId: z.string().optional(),
  compatibleProductIds: z.array(z.string().min(1)).min(1, "Selecciona al menos un producto compatible").max(20),
  operatingDays: z.array(z.coerce.number().int().min(1).max(7)).max(7).optional(),
  operatingStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inicial inválida").optional(),
  operatingEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora final inválida").optional(),
  operatingTimezone: z.string().trim().max(80).default("America/Santiago"),
  code:      z.string().max(50).optional(),
  brand:     z.string().max(100).optional(),
  model:     z.string().max(100).optional(),
  year:      z.coerce.number().int().min(1990).max(2030).optional(),
  worksiteId: z.string().min(1, "Faena requerida"),
  responsibleUserId: z.string().optional(),
  operationalStatus: z.enum(FUEL_VEHICLE_STATUSES).optional(),
  operationalStatusReason: z.string().trim().min(5, "Explica el motivo en al menos 5 caracteres").max(500).optional(),
  soapExpiresAt: z.string().optional(),
  technicalReviewExpiresAt: z.string().optional(),
  circulationPermitExpiresAt: z.string().optional(),
  insurancePolicyNumber: z.string().max(60).optional(),
  insuranceExpiresAt: z.string().optional(),
  notes:     z.string().optional(),
})

export const createFuelVehicleSchema = fuelVehicleBaseSchema.superRefine((value, ctx) => {
  validateMeterPerformancePair(value.meterType, value.performanceUnit, ctx)
  const scheduleParts = [value.operatingDays?.length, value.operatingStart, value.operatingEnd].filter(Boolean).length
  if (scheduleParts > 0 && scheduleParts < 3) {
    ctx.addIssue({ code: "custom", path: ["operatingStart"], message: "Completa días, hora inicial y hora final" })
  }
})

export const updateFuelVehicleSchema = fuelVehicleBaseSchema.partial().extend({
  id: z.string().min(1),
}).superRefine((value, ctx) => {
  if (value.meterType && value.performanceUnit) validateMeterPerformancePair(value.meterType, value.performanceUnit, ctx)
  const scheduleParts = [value.operatingDays?.length, value.operatingStart, value.operatingEnd].filter(Boolean).length
  if (scheduleParts > 0 && scheduleParts < 3) {
    ctx.addIssue({ code: "custom", path: ["operatingStart"], message: "Completa días, hora inicial y hora final" })
  }
})

export type CreateFuelVehicleInput = z.infer<typeof createFuelVehicleSchema>
export type UpdateFuelVehicleInput = z.infer<typeof updateFuelVehicleSchema>

function validateMeterPerformancePair(
  meterType: (typeof FUEL_METER_TYPES)[number],
  performanceUnit: (typeof FUEL_PERFORMANCE_UNITS)[number],
  ctx: z.RefinementCtx,
) {
  if (performanceUnit === "km_per_liter" && meterType !== "odometer") {
    ctx.addIssue({ code: "custom", path: ["performanceUnit"], message: "km/L requiere odómetro" })
  }
  if (performanceUnit === "liters_per_hour" && meterType !== "hour_meter") {
    ctx.addIssue({ code: "custom", path: ["performanceUnit"], message: "L/h requiere horómetro" })
  }
  if (performanceUnit === "not_applicable" && meterType !== "none") {
    ctx.addIssue({ code: "custom", path: ["performanceUnit"], message: "Sin rendimiento requiere seleccionar sin medidor" })
  }
}

/* ── Fuel Supplier ───────────────────────────────────────────────────────── */
export const createFuelSupplierSchema = z.object({
  supplierId:   z.string().optional(),
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

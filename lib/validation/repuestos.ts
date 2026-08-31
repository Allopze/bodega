import { z } from "zod"
import { unitOfMeasureSchema } from "./product-catalogs"

// ── Re-export shared ActionState ──────────────────────────────────────────────
export type { ActionState } from "./masters"

// ── Attribute names used for open-field repuesto items ───────────────────────
// These are stored as request_item_attributes (free-text attributes).
export const REPUESTO_ATTRIBUTE_NAMES = {
  partNumber: "N° de Parte",
  equipmentName: "Equipo",
  patent: "Patente/Código",
  brand: "Marca",
  model: "Modelo",
} as const

// ── Repuesto item (free-text, always uncatalogued) ────────────────────────────
export const repuestoItemSchema = z.object({
  id:              z.string().optional(),
  // Description of the spare part (productNameFree in the DB)
  description:     z.string().trim().min(1, "Describe el repuesto requerido").max(200, "Descripción demasiado larga"),
  quantity:        z.coerce.number().positive("Cantidad debe ser mayor a 0"),
  unitOfMeasure:   unitOfMeasureSchema.default("unidad"),
  sortOrder:       z.coerce.number().int().default(0),
  notes:           z.string().max(300).nullable().optional().or(z.literal("")),
  // Equipment association (open text fields — no catalogue yet)
  partNumber:      z.string().trim().max(80).nullable().optional().or(z.literal("")),
  equipmentName:   z.string().trim().max(150).nullable().optional().or(z.literal("")),
  patent:          z.string().trim().max(20).nullable().optional().or(z.literal("")),
  brand:           z.string().trim().max(80).nullable().optional().or(z.literal("")),
  model:           z.string().trim().max(80).nullable().optional().or(z.literal("")),
})

// ── Repuesto request header ───────────────────────────────────────────────────
export const repuestoRequestSchema = z.object({
  id:           z.string().optional(),
  worksiteId:   z.string().min(1, "Selecciona una faena"),
  urgency:      z.enum(["normal", "high", "critical"]).default("normal"),
  requiredDate: z.string().min(1, "Indica la fecha requerida"),
  // justification is required when submitting with < 3 quotations
  justification: z.string().max(500).optional().or(z.literal("")),
  items: z.array(repuestoItemSchema)
    .min(1, "Agrega al menos un repuesto")
    .max(30, "Máximo 30 ítems por solicitud"),
})

// ── Quotation upload ──────────────────────────────────────────────────────────
export const quotationUploadSchema = z.object({
  requestId:        z.string().min(1, "Solicitud no especificada"),
  totalAmount:      z.coerce
    .number()
    .refine(Number.isFinite, "Debe ser un número válido")
    .min(0, "El monto no puede ser negativo"),
  supplierId:       z.string().nullable().optional(),
  supplierNameFree: z.string().trim().max(150).nullable().optional().or(z.literal("")),
  notes:            z.string().max(300).nullable().optional().or(z.literal("")),
})

// ── Quotation selection (jefa approves one) ───────────────────────────────────
export const selectQuotationSchema = z.object({
  requestId:   z.string().min(1, "Solicitud no especificada"),
  quotationId: z.string().min(1, "Selecciona una cotización"),
})

// ── Cancel request ────────────────────────────────────────────────────────────
export const cancelRepuestoSchema = z.object({
  requestId: z.string().min(1, "Solicitud no especificada"),
  reason:    z.string().trim().min(1, "El motivo de cancelación es obligatorio").max(300),
})

// ── Inferred types ────────────────────────────────────────────────────────────
export type RepuestoRequestFormData = z.infer<typeof repuestoRequestSchema>
export type RepuestoItemFormData    = z.infer<typeof repuestoItemSchema>
export type QuotationUploadData     = z.infer<typeof quotationUploadSchema>
export type SelectQuotationData     = z.infer<typeof selectQuotationSchema>

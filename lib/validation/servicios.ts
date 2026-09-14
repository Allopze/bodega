import { z } from "zod"
import { withQuotationCompleteness } from "./quotation-completeness"
import { REASON_MAX_LENGTH } from "./reason-thresholds"
import { unitOfMeasureSchema } from "./product-catalogs"

// ── Re-export shared ActionState ──────────────────────────────────────────────
export type { ActionState } from "./masters"

// ── Attribute names used for open-field service items ─────────────────────────
// These are stored as request_item_attributes (free-text attributes).
export const SERVICE_ATTRIBUTE_NAMES = {
  location:      "Ubicación",
  equipmentName: "Equipo",
  patent:        "Patente/Código",
  brand:         "Marca",
  model:         "Modelo",
} as const

// ── Service item (free-text, always uncatalogued) ─────────────────────────────
export const serviceItemSchema = z.object({
  id:            z.string().optional(),
  // Description of the service (productNameFree in the DB)
  description:   z.string().trim().min(1, "Describe el servicio requerido").max(200, "Descripción demasiado larga"),
  // Location where the service will be performed (required)
  location:      z.string().trim().min(1, "Indica la ubicación del servicio").max(150, "Ubicación demasiado larga"),
  quantity:      z.coerce.number().positive("Cantidad debe ser mayor a 0"),
  unitOfMeasure: unitOfMeasureSchema.default("servicio"),
  sortOrder:     z.coerce.number().int().default(0),
  notes:         z.string().max(300).nullable().optional().or(z.literal("")),
  // Equipment association (optional open text fields)
  equipmentName: z.string().trim().max(150).nullable().optional().or(z.literal("")),
  patent:        z.string().trim().max(20).nullable().optional().or(z.literal("")),
  brand:         z.string().trim().max(80).nullable().optional().or(z.literal("")),
  model:         z.string().trim().max(80).nullable().optional().or(z.literal("")),
})

// ── Service request header ────────────────────────────────────────────────────
export const serviceRequestSchema = z.object({
  id:           z.string().optional(),
  worksiteId:   z.string().min(1, "Selecciona una faena"),
  urgency:      z.enum(["normal", "high", "critical"]).default("normal"),
  requiredDate: z.string().min(1, "Indica la fecha requerida"),
  // justification is required when submitting with < 3 quotations
  justification: z.string().max(500).optional().or(z.literal("")),
  items: z.array(serviceItemSchema)
    .min(1, "Agrega al menos un servicio")
    .max(30, "Máximo 30 ítems por solicitud"),
})

// ── Quotation upload ──────────────────────────────────────────────────────────
export const serviceQuotationUploadSchema = withQuotationCompleteness(z.object({
  requestId:        z.string().min(1, "Solicitud no especificada"),
  totalAmount:      z.coerce
    .number()
    .refine(Number.isFinite, "Debe ser un número válido")
    .min(0, "El monto no puede ser negativo"),
  supplierId:       z.string().nullable().optional(),
  supplierNameFree: z.string().trim().max(150).nullable().optional().or(z.literal("")),
  notes:            z.string().max(300).nullable().optional().or(z.literal("")),
}))

// ── Quotation selection (jefa approves one) ───────────────────────────────────
export const selectServiceQuotationSchema = z.object({
  requestId:   z.string().min(1, "Solicitud no especificada"),
  quotationId: z.string().min(1, "Selecciona una cotización"),
  /**
   * COT-002: por qué esta oferta. El servicio decide si es obligatorio —lo es
   * cuando la elegida no es la más económica—, porque sólo él ve las demás
   * ofertas bajo bloqueo. Acá sólo se transporta.
   */
  justification: z.string().trim().max(REASON_MAX_LENGTH).nullable().optional().or(z.literal("")),
})

// ── Cancel request ────────────────────────────────────────────────────────────
export const cancelServiceSchema = z.object({
  requestId: z.string().min(1, "Solicitud no especificada"),
  reason:    z.string().trim().min(1, "El motivo de cancelación es obligatorio").max(300),
})

// ── Inferred types ────────────────────────────────────────────────────────────
export type ServiceRequestFormData       = z.infer<typeof serviceRequestSchema>
export type ServiceItemFormData          = z.infer<typeof serviceItemSchema>
export type ServiceQuotationUploadData   = z.infer<typeof serviceQuotationUploadSchema>
export type SelectServiceQuotationData   = z.infer<typeof selectServiceQuotationSchema>

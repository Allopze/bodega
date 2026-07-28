import { z } from "zod"

// ── Re-export shared ActionState ──────────────────────────────────────────────
export type { ActionState } from "./masters"

const CHILE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Santiago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

function todayInChile(): string {
  const parts = CHILE_DATE_FORMATTER.formatToParts(new Date())
  const value = (part: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === part)?.value
  return `${value("year")}-${value("month")}-${value("day")}`
}

function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const requiredOperationalDate = z.string()
  .refine(isRealIsoDate, "Fecha requerida inválida")
  .refine((value) => value >= todayInChile(), "La fecha requerida no puede estar en el pasado")

// ── Request item attribute ────────────────────────────────────────────────────
export const requestItemAttributeSchema = z.object({
  id:            z.string().optional(),
  attributeId:   z.string().optional().nullable(),
  attributeName: z.string().trim().min(1, "Nombre requerido").max(60, "Nombre demasiado largo"),
  value:         z.string().trim().min(1, "Valor requerido").max(64, "Valor demasiado largo"),
})

// ── Request item ──────────────────────────────────────────────────────────────
export const requestItemSchema = z.object({
  id:                  z.string().optional(),
  productId:           z.string().nullable().optional(),
  productNameFree:     z.string().max(120).nullable().optional().or(z.literal("")),
  quantity:            z.coerce.number().positive("Cantidad debe ser mayor a 0"),
  unitOfMeasure:       z.string().min(1, "Unidad requerida").max(20).default("unidad"),
  urgency:             z.enum(["normal", "high", "critical"]).default("normal"),
  requiredDate:        requiredOperationalDate.optional().nullable(),
  workerId:            z.string().optional().nullable(),
  suggestedSupplierId: z.string().nullable().optional(),
  supplierHint:        z.string().max(100).nullable().optional().or(z.literal("")),
  sortOrder:           z.coerce.number().int().default(0),
  notes:               z.string().max(300).nullable().optional().or(z.literal("")),
  attributes:          z.array(requestItemAttributeSchema).default([]),
  // Equipment fields — only used by quotation types (repuestos/servicios);
  // persisted as item attributes by the request-service factory.
  partNumber:          z.string().max(80).nullable().optional().or(z.literal("")),
  location:            z.string().max(150).nullable().optional().or(z.literal("")),
  equipmentName:       z.string().max(150).nullable().optional().or(z.literal("")),
  patent:              z.string().max(20).nullable().optional().or(z.literal("")),
  brand:               z.string().max(80).nullable().optional().or(z.literal("")),
  model:               z.string().max(80).nullable().optional().or(z.literal("")),
}).refine(
  (d) => !!d.productId || !!d.productNameFree?.trim(),
  { message: "Selecciona un producto del catálogo o describe el ítem", path: ["productId"] },
)

// ── Purchase request (header) ─────────────────────────────────────────────────
export const requestSchema = z.object({
  id:           z.string().optional(),
  worksiteId:   z.string().min(1, "Selecciona una faena"),
  requestType:  z.enum(["epp", "otro", "repuestos", "servicios"]).default("epp"),
  urgency:      z.enum(["normal", "high", "critical"]).default("normal"),
  deliveryMode: z.enum(["via_oficina", "directo_faena"]).optional().default("via_oficina"),
  requiredDate: requiredOperationalDate.min(1, "Indica la fecha requerida"),
  notes:        z.string().max(500).optional().or(z.literal("")),
  items:        z.array(requestItemSchema).min(1, "Agrega al menos un ítem").max(50, "Máximo 50 ítems por solicitud"),
}).refine(
  (d) => d.requestType !== "servicios" || d.items.every((item) => !!item.location?.trim()),
  { message: "Ubicación requerida para cada servicio", path: ["items"] },
)

export type RequestFormData = Omit<z.infer<typeof requestSchema>, "deliveryMode"> & {
  deliveryMode?: "via_oficina" | "directo_faena"
}
export type RequestItemFormData = z.infer<typeof requestItemSchema>

// ── Purchase order ───────────────────────────────────────────────────────────
const finiteMoneySchema = z.coerce
  .number()
  .refine(Number.isFinite, "Debe ser un número válido")
  .min(0, "No puede ser negativo")

const positiveQuantitySchema = z.coerce
  .number()
  .refine(Number.isFinite, "Cantidad inválida")
  .positive("Cantidad debe ser mayor a 0")

const nonNegativeQuantitySchema = z.coerce
  .number()
  .refine(Number.isFinite, "Cantidad inválida")
  .min(0, "Cantidad no puede ser negativa")

export const createOrderItemSchema = z.object({
  requestItemId:   z.string().min(1, "Ítem requerido"),
  supplierId:      z.string().nullable().optional(),
  isSupplierOverride: z.boolean().optional(),
  productId:       z.string().nullable().optional(),
  productNameFree: z.string().nullable().optional(),
  quantity:        z.coerce.number().refine(Number.isFinite, "Cantidad inválida").positive("Cantidad debe ser mayor a 0"),
  unitOfMeasure:   z.string().min(1, "Unidad requerida").max(20),
  unitPrice:       finiteMoneySchema,
  discount:        z.coerce.number().refine(Number.isFinite, "Descuento inválido").min(0).max(100).default(0),
  notes:           z.string().max(300).nullable().optional().or(z.literal("")),
})

export const createOrderSchema = z.object({
  worksiteId:        z.string().min(1, "Selecciona una faena"),
  supplierId:        z.string().optional().or(z.literal("")),
  paymentTerms:      z.string().max(120).nullable().optional().or(z.literal("")),
  estimatedDelivery: z.string().nullable().optional().or(z.literal("")),
  deliveryAddress:   z.string().max(240).nullable().optional().or(z.literal("")),
  notes:             z.string().max(500).nullable().optional().or(z.literal("")),
  items:             z.array(createOrderItemSchema).min(1, "Selecciona al menos un ítem para la orden"),
})

export type CreateOrderFormData = z.infer<typeof createOrderSchema>
export type CreateOrderItemFormData = z.infer<typeof createOrderItemSchema>

// ── Receipt ──────────────────────────────────────────────────────────────────
export const receiptItemSchema = z.object({
  purchaseOrderItemId: z.string().min(1, "Ítem de OC requerido"),
  // Recibido puede ser 0 cuando toda la línea llegó rechazada/dañada (M-3).
  quantityReceived:    nonNegativeQuantitySchema.default(0),
  quantityRejected:    nonNegativeQuantitySchema.default(0),
  quantityDamaged:     nonNegativeQuantitySchema.default(0),
  notes:               z.string().max(300).nullable().optional().or(z.literal("")),
  lotNumber:           z.string().trim().max(120).nullable().optional().or(z.literal("")),
  manufacturedAt:      z.string().trim().max(10).nullable().optional().or(z.literal("")),
  expiresAt:           z.string().trim().max(10).nullable().optional().or(z.literal("")),
}).refine(
  (d) => d.quantityReceived + d.quantityRejected + d.quantityDamaged > 0,
  { message: "Registra al menos una cantidad (recibida, rechazada o dañada)", path: ["quantityReceived"] },
)

export const receiptSchema = z.object({
  purchaseOrderId:  z.string().min(1, "OC no especificada"),
  stage:            z.enum(["office", "faena"]).default("office"),
  worksiteId:       z.string().nullable().optional().or(z.literal("")),
  dispatchGuideNo:  z.string().max(80).nullable().optional().or(z.literal("")),
  notes:            z.string().max(500).nullable().optional().or(z.literal("")),
  items:            z.array(receiptItemSchema).min(1, "Ingresa las cantidades recibidas"),
})

// ── Stock dispatch ──────────────────────────────────────────────────────────
export const dispatchSchema = z.object({
  worksiteId:     z.string().min(1, "Selecciona una faena"),
  productId:      z.string().min(1, "Selecciona un producto"),
  requestItemId:  z.string().nullable().optional().or(z.literal("")),
  quantity:       positiveQuantitySchema,
  unitOfMeasure:  z.string().min(1, "Unidad requerida").max(20).default("unidad"),
  receiverName:   z.string().trim().min(1, "Indica quién recibió").max(120),
  notes:          z.string().trim().max(500).nullable().optional().or(z.literal("")),
})

export const workerDeliverySchema = z.object({
  worksiteId:    z.string().min(1, "Selecciona una faena"),
  workerId:      z.string().min(1, "Selecciona un trabajador"),
  requestItemId: z.string().min(1, "Selecciona un EPP recibido"),
  quantity:      positiveQuantitySchema,
  receiverName:  z.string().trim().max(120).nullable().optional().or(z.literal("")),
  notes:         z.string().trim().max(500).nullable().optional().or(z.literal("")),
  // Return of old/discarded EPP (opcional)
  returnProductId:       z.string().nullable().optional().or(z.literal("")),
  returnProductNameFree: z.string().trim().max(120).nullable().optional().or(z.literal("")),
  returnQuantity:        positiveQuantitySchema.nullable().optional(),
  returnReason:          z.string().trim().max(30).nullable().optional().or(z.literal("")),
  returnNotes:           z.string().trim().max(300).nullable().optional().or(z.literal("")),
})

// ── Stock min threshold ─────────────────────────────────────────────────────
export const setMinStockSchema = z.object({
  stockId:   z.string().min(1),
  minStock:  z.coerce.number().refine(Number.isFinite, "Valor inválido").min(0, "No puede ser negativo"),
})

// ── Stock adjust ────────────────────────────────────────────────────────────
export const adjustStockSchema = z.object({
  worksiteId: z.string().min(1, "Selecciona una faena"),
  productId:  z.string().min(1, "Selecciona un producto"),
  quantity:   positiveQuantitySchema,
  direction:  z.enum(["ingreso", "egreso"]),
  reason:     z.string().trim().min(1, "Indica el motivo del ajuste").max(300),
  notes:      z.string().trim().max(500).nullable().optional().or(z.literal("")),
})

// ── Stock return ────────────────────────────────────────────────────────────
export const returnStockSchema = z.object({
  deliveryItemId: z.string().min(1, "Selecciona una entrega para devolver"),
  quantity:     positiveQuantitySchema,
  reason:       z.string().trim().min(1, "Indica el motivo de la devolución").max(300),
  notes:        z.string().trim().max(500).nullable().optional().or(z.literal("")),
})

// ── Purchase Order Invoice ───────────────────────────────────────────────────
export const invoiceSchema = z.object({
  purchaseOrderId: z.string().min(1, "ID de OC requerido"),
  invoiceNumber:   z.string().trim().min(1, "N° de factura requerido").max(60, "N° de factura demasiado largo"),
  amount:          finiteMoneySchema,
  issueDate:       z.string().trim().min(1, "Fecha de emisión requerida"),
})

export type InvoiceFormData = z.infer<typeof invoiceSchema>

export type ReceiptFormData = z.infer<typeof receiptSchema>
export type DispatchFormData = z.infer<typeof dispatchSchema>
export type WorkerDeliveryFormData = z.infer<typeof workerDeliverySchema>
export type AdjustStockFormData = z.infer<typeof adjustStockSchema>
export type SetMinStockFormData = z.infer<typeof setMinStockSchema>
export type ReturnStockFormData = z.infer<typeof returnStockSchema>

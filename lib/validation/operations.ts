import { z } from "zod"

// ── Re-export shared ActionState ──────────────────────────────────────────────
export type { ActionState } from "./masters"

// ── Request item attribute ────────────────────────────────────────────────────
export const requestItemAttributeSchema = z.object({
  id:            z.string().optional(),
  attributeId:   z.string().optional().nullable(),
  attributeName: z.string().min(1),
  value:         z.string().min(1, "Valor requerido"),
})

// ── Request item ──────────────────────────────────────────────────────────────
export const requestItemSchema = z.object({
  id:                  z.string().optional(),
  productId:           z.string().nullable().optional(),
  productNameFree:     z.string().max(120).nullable().optional().or(z.literal("")),
  quantity:            z.coerce.number().positive("Cantidad debe ser mayor a 0"),
  unitOfMeasure:       z.string().min(1, "Unidad requerida").max(20).default("unidad"),
  urgency:             z.enum(["normal", "high", "critical"]).default("normal"),
  requiredDate:        z.string().optional().nullable(),
  workerId:            z.string().optional().nullable(),
  suggestedSupplierId: z.string().nullable().optional(),
  supplierHint:        z.string().max(100).nullable().optional().or(z.literal("")),
  sortOrder:           z.coerce.number().int().default(0),
  notes:               z.string().max(300).nullable().optional().or(z.literal("")),
  attributes:          z.array(requestItemAttributeSchema).default([]),
}).refine(
  (d) => !!d.productId || !!d.productNameFree?.trim(),
  { message: "Selecciona un producto del catálogo o describe el ítem", path: ["productId"] },
)

// ── Purchase request (header) ─────────────────────────────────────────────────
export const requestSchema = z.object({
  id:           z.string().optional(),
  worksiteId:   z.string().min(1, "Selecciona una faena"),
  requestType:  z.enum(["epp", "stock", "mantencion", "otro"]).default("epp"),
  urgency:      z.enum(["normal", "high", "critical"]).default("normal"),
  requiredDate: z.string().optional().nullable(),
  notes:        z.string().max(500).optional().or(z.literal("")),
  items:        z.array(requestItemSchema).min(1, "Agrega al menos un ítem").max(50, "Máximo 50 ítems por solicitud"),
})

export type RequestFormData = z.infer<typeof requestSchema>
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
  supplierId:        z.string().min(1, "Selecciona un proveedor"),
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
  quantityReceived:    positiveQuantitySchema,
  quantityRejected:    nonNegativeQuantitySchema.default(0),
  quantityDamaged:     nonNegativeQuantitySchema.default(0),
  notes:               z.string().max(300).nullable().optional().or(z.literal("")),
})

export const receiptSchema = z.object({
  purchaseOrderId:  z.string().min(1, "OC no especificada"),
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

// ── Stock min threshold ─────────────────────────────────────────────────────
export const setMinStockSchema = z.object({
  stockId:   z.string().min(1),
  minStock:  z.coerce.number().refine(Number.isFinite, "Valor inválido").min(0, "No puede ser negativo"),
})

// ── Stock return ────────────────────────────────────────────────────────────
export const returnStockSchema = z.object({
  worksiteId:   z.string().min(1, "Selecciona una faena"),
  productId:    z.string().min(1, "Selecciona un producto"),
  quantity:     positiveQuantitySchema,
  reason:       z.string().trim().min(1, "Indica el motivo de la devolución").max(300),
  notes:        z.string().trim().max(500).nullable().optional().or(z.literal("")),
})

export type ReceiptFormData = z.infer<typeof receiptSchema>
export type DispatchFormData = z.infer<typeof dispatchSchema>
export type SetMinStockFormData = z.infer<typeof setMinStockSchema>
export type ReturnStockFormData = z.infer<typeof returnStockSchema>

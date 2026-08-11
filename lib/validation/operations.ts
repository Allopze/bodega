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

/** Exportada para que los servicios validen fechas con el mismo criterio que los formularios. */
export function isRealIsoDate(value: string): boolean {
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
  /** Equipo del registro al que apunta el servicio (monogás, alcotest). */
  equipmentId:         z.string().optional().nullable(),
  suggestedSupplierId: z.string().nullable().optional(),
  supplierHint:        z.string().max(100).nullable().optional().or(z.literal("")),
  sortOrder:           z.coerce.number().int().default(0),
  notes:               z.string().max(300).nullable().optional().or(z.literal("")),
  attributes:          z.array(requestItemAttributeSchema).default([]),
  // Brecha de EPP que originó el ítem precargado; reserva su cupo al crear.
  replenishmentGapKey: z.string().max(300).nullable().optional().or(z.literal("")),
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

/**
 * `null` = costo pendiente: el ítem es un servicio cuyo precio todavía no se
 * conoce. `z.coerce.number()` convierte `""` en 0, que es justo la confusión
 * que hay que evitar (0 significa "sin costo"), así que el vacío se normaliza
 * a `null` antes de coercionar.
 */
const pendingOrKnownMoneySchema = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  finiteMoneySchema.nullable(),
)

export const createOrderItemSchema = z.object({
  requestItemId:   z.string().min(1, "Ítem requerido"),
  supplierId:      z.string().nullable().optional(),
  isSupplierOverride: z.boolean().optional(),
  productId:       z.string().nullable().optional(),
  productNameFree: z.string().nullable().optional(),
  quantity:        z.coerce.number().refine(Number.isFinite, "Cantidad inválida").positive("Cantidad debe ser mayor a 0"),
  unitOfMeasure:   z.string().min(1, "Unidad requerida").max(20),
  unitPrice:       pendingOrKnownMoneySchema,
  discount:        z.coerce.number().refine(Number.isFinite, "Descuento inválido").min(0).max(100).default(0),
  notes:           z.string().max(300).nullable().optional().or(z.literal("")),
})

/**
 * Registro posterior del costo real de una línea de OC que nació con costo
 * pendiente. Sólo el precio: cantidad, producto y descuento ya están fijados
 * por la orden y no se reescriben desde aquí.
 */
export const recordItemCostSchema = z.object({
  purchaseOrderItemId: z.string().min(1, "Ítem de la orden requerido"),
  unitPrice:           finiteMoneySchema,
  notes:               z.string().max(300).nullable().optional().or(z.literal("")),
})

export type RecordItemCostFormData = z.infer<typeof recordItemCostSchema>

export const createOrderSchema = z.object({
  worksiteId:        z.string().min(1, "Selecciona una faena"),
  supplierId:        z.string().optional().or(z.literal("")),
  paymentTerms:      z.string().max(120).nullable().optional().or(z.literal("")),
  // Misma razón que `issueDate`: columna text sin CHECK. Vacío sigue valiendo
  // (la fecha estimada es opcional), pero un valor presente debe ser una fecha.
  estimatedDelivery: z.string().nullable().optional()
                      .refine((v) => !v || isRealIsoDate(v), "Fecha estimada inválida"),
  deliveryAddress:   z.string().max(240).nullable().optional().or(z.literal("")),
  notes:             z.string().max(500).nullable().optional().or(z.literal("")),
  items:             z.array(createOrderItemSchema)
                      .min(1, "Selecciona al menos un ítem para la orden")
                      .max(200, "Demasiados ítems para una sola orden"),
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
}).refine(
  // Los cuatro campos eran opcionales de forma independiente, así que una
  // cantidad sin producto quedaba registrada como "devolución de nada" (y sin
  // mover stock). Si se declara una devolución, tiene que decir qué y por qué.
  (d) => !d.returnQuantity || Boolean(d.returnProductId || d.returnProductNameFree?.trim()),
  { message: "Indica qué producto se devuelve", path: ["returnProductId"] },
).refine(
  (d) => !d.returnQuantity || Boolean(d.returnReason?.trim()),
  { message: "Indica el motivo de la devolución", path: ["returnReason"] },
)

// ── Stock min threshold ─────────────────────────────────────────────────────
export const setMinStockSchema = z.object({
  stockId:   z.string().min(1),
  minStock:  z.coerce.number().refine(Number.isFinite, "Valor inválido").min(0, "No puede ser negativo"),
})

// ── Physical stock delivery to worker ───────────────────────────────────────
// The browser sends `items` as JSON because one delivery can contain several
// products. Validate the complete nested shape again at the action boundary;
// the service repeats the business invariants under its transaction.
export const workerStockDeliveryItemSchema = z.object({
  productId: z.string().min(1, "Selecciona un producto"),
  quantity: positiveQuantitySchema,
  requestItemId: z.string().nullable().optional().or(z.literal("")),
  notes: z.string().trim().max(300).nullable().optional().or(z.literal("")),
})

export const workerStockDeliverySchema = z.object({
  sourceWorksiteId: z.string().min(1, "Selecciona la bodega de origen"),
  workerId: z.string().min(1, "Selecciona un trabajador"),
  receiverName: z.string().trim().max(120).nullable().optional().or(z.literal("")),
  notes: z.string().trim().max(500).nullable().optional().or(z.literal("")),
  items: z.array(workerStockDeliveryItemSchema)
    .min(1, "Agrega al menos un producto")
    .max(50, "Máximo 50 productos por entrega"),
}).superRefine((data, context) => {
  const productIds = new Set<string>()
  const requestItemIds = new Set<string>()

  data.items.forEach((item, index) => {
    if (productIds.has(item.productId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "productId"],
        message: "No repitas un producto en la entrega",
      })
    }
    productIds.add(item.productId)

    if (item.requestItemId) {
      if (requestItemIds.has(item.requestItemId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "requestItemId"],
          message: "No repitas un ítem de solicitud en la entrega",
        })
      }
      requestItemIds.add(item.requestItemId)
    }
  })
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
  // Fecha real, no cualquier string: la columna es `text` sin CHECK (a
  // diferencia de billing_invoices), así que "hola" se persistía y la ficha de
  // la OC mostraba basura. No se exige que sea futura: una factura se emite antes.
  issueDate:       z.string().trim().min(1, "Fecha de emisión requerida")
                    .refine(isRealIsoDate, "Fecha de emisión inválida"),
})

export type InvoiceFormData = z.infer<typeof invoiceSchema>

export type ReceiptFormData = z.infer<typeof receiptSchema>
export type WorkerDeliveryFormData = z.infer<typeof workerDeliverySchema>
export type WorkerStockDeliveryFormData = z.infer<typeof workerStockDeliverySchema>
export type AdjustStockFormData = z.infer<typeof adjustStockSchema>
export type SetMinStockFormData = z.infer<typeof setMinStockSchema>
export type ReturnStockFormData = z.infer<typeof returnStockSchema>

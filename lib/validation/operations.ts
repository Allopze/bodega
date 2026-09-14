import { z } from "zod"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { normalizeEquipmentCode } from "@/lib/products/service-items"
import { unitOfMeasureSchema } from "./product-catalogs"
import { reasonSchema } from "./reason-thresholds"

// ── Re-export shared ActionState ──────────────────────────────────────────────
export type { ActionState } from "./masters"

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
  unitOfMeasure:       unitOfMeasureSchema.default("unidad"),
  urgency:             z.enum(["normal", "high", "critical"]).default("normal"),
  requiredDate:        requiredOperationalDate.optional().nullable(),
  workerId:            z.string().optional().nullable(),
  /**
   * Código interno del equipo al que apunta el servicio (monogás, alcotest).
   * Es un código, no un id: si el equipo no está en el registro se da de alta
   * al crear la solicitud, en la faena de quien la pide.
   */
  equipmentCode:       z.string().trim().max(40).transform(normalizeEquipmentCode)
                         .optional().nullable(),
  emergencyResourceId: z.string().trim().max(120).optional().nullable(),
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
  unitOfMeasure:   unitOfMeasureSchema,
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
  maintenanceDate:     z.string().optional().nullable()
                         .refine((value) => !value || isRealIsoDate(value), "Fecha de mantención inválida"),
  nextExpiryDate:      z.string().optional().nullable()
                         .refine((value) => !value || isRealIsoDate(value), "Próximo vencimiento inválido"),
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

/**
 * Devolución del EPP usado que se canjea por el nuevo.
 *
 * ENT-002 (auditoría 2026-09-14): estas cinco columnas existen en
 * `delivery_items`, la impresión de la entrega y la trazabilidad las leen y las
 * muestran, y este esquema las validaba… pero ninguna acción lo usaba: el único
 * `insert` de `delivery_items` no las seteaba y el tipo de movimiento
 * `retiro_epp_trabajador` no tenía emisor. El canje "entrego nuevo, retiro
 * usado" no era operable.
 *
 * La forma se extrae aquí para que el esquema por línea de la entrega física
 * —el que sí se usa— la comparta en vez de duplicarla y desincronizarse.
 */
export const eppReturnFields = {
  returnProductId:       z.string().nullable().optional().or(z.literal("")),
  returnProductNameFree: z.string().trim().max(120).nullable().optional().or(z.literal("")),
  returnQuantity:        positiveQuantitySchema.nullable().optional(),
  returnReason:          z.string().trim().max(30).nullable().optional().or(z.literal("")),
  returnNotes:           z.string().trim().max(300).nullable().optional().or(z.literal("")),
}

export interface EppReturnDeclaration {
  returnProductId?: string | null
  returnProductNameFree?: string | null
  returnQuantity?: number | null
  returnReason?: string | null
}

/**
 * Los cinco campos son opcionales de forma independiente, así que una cantidad
 * sin producto quedaba registrada como "devolución de nada" (y sin mover nada).
 * Si se declara una devolución, tiene que decir qué y por qué.
 */
export function eppReturnIssues(value: EppReturnDeclaration): Array<{ path: string; message: string }> {
  if (!value.returnQuantity) return []
  const issues: Array<{ path: string; message: string }> = []
  if (!value.returnProductId && !value.returnProductNameFree?.trim()) {
    issues.push({ path: "returnProductId", message: "Indica qué producto se devuelve" })
  }
  if (!value.returnReason?.trim()) {
    issues.push({ path: "returnReason", message: "Indica el motivo de la devolución" })
  }
  return issues
}

export const workerDeliverySchema = z.object({
  worksiteId:    z.string().min(1, "Selecciona una faena"),
  workerId:      z.string().min(1, "Selecciona un trabajador"),
  requestItemId: z.string().min(1, "Selecciona un EPP recibido"),
  quantity:      positiveQuantitySchema,
  receiverName:  z.string().trim().max(120).nullable().optional().or(z.literal("")),
  notes:         z.string().trim().max(500).nullable().optional().or(z.literal("")),
  ...eppReturnFields,
}).superRefine((value, ctx) => {
  for (const issue of eppReturnIssues(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message })
  }
})

// ── Stock min threshold ─────────────────────────────────────────────────────
export const setMinStockSchema = z.object({
  stockId:   z.string().min(1),
  minStock:  z.coerce.number().refine(Number.isFinite, "Valor inválido").min(0, "No puede ser negativo"),
})

/**
 * Definición masiva de mínimos: una fila por producto de la faena. El formulario
 * envía arreglos paralelos y la acción sólo conserva las filas efectivamente
 * tecleadas — una celda en blanco significa "no tocar", no "poner 0".
 */
export const setMinStockBulkSchema = z.object({
  worksiteId: z.string().min(1, "Selecciona una faena"),
  items: z.array(z.object({
    stockId:  z.string().min(1),
    minStock: z.coerce.number().refine(Number.isFinite, "Valor inválido").min(0, "No puede ser negativo"),
  })).min(1, "Escribe al menos un mínimo"),
})

/**
 * ENT-003 (auditoría 2026-09-14): `deliveredAt` sólo se validaba como fecha real
 * y no futura. Sin cota inferior, una entrega registrada hoy podía quedar
 * fechada en un período ya informado —y acreditar allí la actividad N°62 del
 * PDTP, porque el servicio usa esa misma fecha como `occurredAt`—.
 *
 * ⚠️ **Valor por defecto pendiente de confirmación.** La auditoría constata el
 * vacío pero no declara cuál es el plazo aceptable, y no corresponde inventarlo
 * en silencio: 90 días es un tope operacional prudente —cubre holgadamente el
 * rezago normal de un comprobante en papel— que Prevención y Administración
 * deben confirmar o cambiar. Está aquí, con nombre y en un solo sitio, para que
 * cambiarlo sea una línea y no una búsqueda.
 *
 * Lo que este tope **no** decide: si una entrega retroactiva debe acreditar en
 * el período del hecho o en el de su registro. Eso sigue igual (acredita en el
 * período del hecho, que es lo que ocurrió) y es política del PDTP, no de este
 * formulario; lo que cambia es que ya no puede alcanzar un período
 * arbitrariamente antiguo.
 */
export const MAX_DELIVERY_BACKDATING_DAYS = 90

/** La fecha civil chilena más antigua que admite una entrega registrada hoy. */
export function earliestDeliveryDate(today: string = todayInChile()): string {
  return addDaysToPlainDate(today, -MAX_DELIVERY_BACKDATING_DAYS)
}

/**
 * Accionable a propósito: decir "fecha inválida" deja al bodeguero sin saber
 * qué hacer con un comprobante de hace un año que sí existe.
 */
export function backdatedDeliveryMessage(today: string = todayInChile()): string {
  return `La entrega no puede fecharse antes del ${earliestDeliveryDate(today)} `
    + `(${MAX_DELIVERY_BACKDATING_DAYS} días de retroactividad). `
    + "Si el comprobante es más antiguo, regístralo con una fecha dentro del plazo "
    + "y explica el desfase en las notas, o pide a Administración que confirme el plazo."
}

// ── Physical stock delivery to worker ───────────────────────────────────────
// The browser sends `items` as JSON because one delivery can contain several
// products. Validate the complete nested shape again at the action boundary;
// the service repeats the business invariants under its transaction.
export const workerStockDeliveryItemSchema = z.object({
  productId: z.string().min(1, "Selecciona un producto"),
  quantity: positiveQuantitySchema,
  requestItemId: z.string().nullable().optional().or(z.literal("")),
  notes: z.string().trim().max(300).nullable().optional().or(z.literal("")),
  // ENT-002: el canje se declara en la línea del EPP nuevo, que es donde
  // `delivery_items` ya tiene las columnas y donde la impresión lo lee.
  ...eppReturnFields,
})

export const workerStockDeliverySchema = z.object({
  sourceWorksiteId: z.string().min(1, "Selecciona la bodega de origen"),
  workerId: z.string().min(1, "Selecciona un trabajador"),
  // Fecha operacional del comprobante. Opcional: ausente ⇒ hoy. Nunca futura, y
  // con la retroactividad acotada por `MAX_DELIVERY_BACKDATING_DAYS`.
  deliveredAt: z.string()
    .refine(isRealIsoDate, "Fecha de entrega inválida")
    .refine((value) => value <= todayInChile(), "La entrega no puede tener fecha futura")
    // `superRefine` y no `refine`: el mensaje nombra la fecha del borde, que se
    // calcula al validar y no al cargar el módulo (un servidor vive más de un
    // día).
    .superRefine((value, ctx) => {
      const today = todayInChile()
      if (value >= earliestDeliveryDate(today)) return
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: backdatedDeliveryMessage(today) })
    })
    .optional(),
  receiverName: z.string().trim().max(120).nullable().optional().or(z.literal("")),
  notes: z.string().trim().max(500).nullable().optional().or(z.literal("")),
  items: z.array(workerStockDeliveryItemSchema)
    .min(1, "Agrega al menos un producto")
    .max(50, "Máximo 50 productos por entrega"),
}).superRefine((data, context) => {
  const productIds = new Set<string>()
  const requestItemIds = new Set<string>()

  data.items.forEach((item, index) => {
    // ENT-002: la coherencia del canje se comprueba por línea y con la ruta de
    // la línea, para que el error aterrice en el campo que lo causó.
    for (const issue of eppReturnIssues(item)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, issue.path],
        message: issue.message,
      })
    }

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
  /*
   * STK-002 (auditoría 2026-09-14), patrón P6: pedía un carácter. El ajuste de
   * inventario es la única operación que fija cualquier saldo sin documento de
   * origen, y era la que menos explicación exigía de toda la plataforma.
   */
  reason:     reasonSchema("el ajuste de inventario"),
  notes:      z.string().trim().max(500).nullable().optional().or(z.literal("")),
})

// ── Stock discard (baja por desecho) ────────────────────────────────────────
// Sin `direction`: una baja siempre resta. El motor ya validaba el tipo
// `egreso_desecho`, pero ninguna pantalla lo emitía.
export const discardStockSchema = z.object({
  worksiteId: z.string().min(1, "Selecciona una faena"),
  productId:  z.string().min(1, "Selecciona un producto"),
  quantity:   positiveQuantitySchema,
  reason:     reasonSchema("la baja de inventario"),
  notes:      z.string().trim().max(500).nullable().optional().or(z.literal("")),
})

// ── Stock return ────────────────────────────────────────────────────────────
export const returnStockSchema = z.object({
  deliveryItemId: z.string().min(1, "Selecciona una entrega para devolver"),
  quantity:     positiveQuantitySchema,
  reason:       reasonSchema("la devolución"),
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
export type SetMinStockBulkFormData = z.infer<typeof setMinStockBulkSchema>
export type DiscardStockFormData = z.infer<typeof discardStockSchema>
export type ReturnStockFormData = z.infer<typeof returnStockSchema>

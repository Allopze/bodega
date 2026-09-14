import { relations, sql } from "drizzle-orm"
import { pgTable, text, real, integer, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites, workers } from "./worksites"
import { products } from "./products"
import { fuelVehicles } from "./fuel-vehicles"
import { purchaseOrders, purchaseOrderItems } from "./purchasing"
import { receipts, receiptItems } from "./receiving"

/* ── Guías de Despacho Internas (GDI) ─────────────────────────────────────────
 *
 * Documento interno de traslado Oficina CHOME → Faena. No es un DTE del SII:
 * no lleva folio tributario, CAF ni firma electrónica.
 *
 * El origen es SIEMPRE la faena que representa la oficina central (resuelta en
 * `lib/services/dispatch-guides.ts`), nunca un texto libre: por eso
 * `originWorksiteId` es una FK y el CHECK impide que coincida con el destino.
 * La dirección inversa (faena → oficina) y las laterales (faena → faena) no
 * existen en este documento; se validan en el servicio además del CHECK.
 */
export const dispatchGuides = pgTable("dispatch_guides", {
  id:                    text("id").primaryKey(),
  code:                  text("code").notNull().unique(),          // "GDI-000001"
  status:                text("status").notNull().default("draft"), // draft | dispatched | partially_received | received | cancelled
  originWorksiteId:      text("origin_worksite_id").notNull().references(() => worksites.id),
  destinationWorksiteId: text("destination_worksite_id").notNull().references(() => worksites.id),
  /** Relaciones opcionales para conservar guías históricas creadas fuera de adquisiciones. */
  purchaseOrderId:       text("purchase_order_id").references(() => purchaseOrders.id),
  receiptId:             text("receipt_id").references(() => receipts.id),
  /** Quién emitió el documento en la plataforma (fecha/hora la fija el backend). */
  issuedBy:              text("issued_by").notNull().references(() => users.id),
  issuedAt:              timestamp("issued_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  /** Colaborador que prepara/entrega en oficina. Null = el emisor del documento. */
  dispatcherWorkerId:    text("dispatcher_worker_id").references(() => workers.id),
  /** Colaborador que se espera reciba en faena. */
  receiverWorkerId:      text("receiver_worker_id").references(() => workers.id),
  vehicleId:             text("vehicle_id").references(() => fuelVehicles.id),
  driverWorkerId:        text("driver_worker_id").references(() => workers.id),
  notes:                 text("notes"),

  dispatchedAt:          timestamp("dispatched_at", { withTimezone: true, mode: "string" }),
  dispatchedBy:          text("dispatched_by").references(() => users.id),

  receivedAt:            timestamp("received_at", { withTimezone: true, mode: "string" }),
  /** Usuario que ejecutó la confirmación en la plataforma. */
  receivedBy:            text("received_by").references(() => users.id),
  /** Colaborador que efectivamente recibió los bienes en faena. */
  receivedByWorkerId:    text("received_by_worker_id").references(() => workers.id),

  cancelledAt:           timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  cancelledBy:           text("cancelled_by").references(() => users.id),
  cancellationReason:    text("cancellation_reason"),

  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("dispatch_guides_status_valid", sql`
    ${table.status} IN ('draft', 'dispatched', 'partially_received', 'received', 'cancelled')
  `),
  // Oficina → Faena: un traslado sobre sí mismo no es un traslado.
  check("dispatch_guides_origin_differs_destination", sql`
    ${table.originWorksiteId} <> ${table.destinationWorksiteId}
  `),
  // Un borrador no puede tener sello de despacho; una guía despachada/recibida
  // no puede no tenerlo. `cancelled` conserva el sello que ya tenía (o ninguno,
  // si se anuló siendo borrador): anular no reescribe la historia.
  check("dispatch_guides_dispatch_stamp_valid", sql`
    (${table.status} = 'draft' AND ${table.dispatchedAt} IS NULL AND ${table.dispatchedBy} IS NULL)
    OR (${table.status} IN ('dispatched', 'partially_received', 'received') AND ${table.dispatchedAt} IS NOT NULL AND ${table.dispatchedBy} IS NOT NULL)
    OR ${table.status} = 'cancelled'
  `),
  check("dispatch_guides_receipt_stamp_valid", sql`
    (${table.status} IN ('partially_received', 'received') AND ${table.receivedAt} IS NOT NULL AND ${table.receivedBy} IS NOT NULL)
    OR (${table.status} IN ('draft', 'dispatched') AND ${table.receivedAt} IS NULL AND ${table.receivedBy} IS NULL)
    OR ${table.status} = 'cancelled'
  `),
  check("dispatch_guides_cancellation_stamp_valid", sql`
    (${table.status} = 'cancelled'
      AND ${table.cancelledAt} IS NOT NULL
      AND ${table.cancelledBy} IS NOT NULL
      AND char_length(trim(${table.cancellationReason})) >= 10)
    OR (${table.status} <> 'cancelled'
      AND ${table.cancelledAt} IS NULL
      AND ${table.cancelledBy} IS NULL
      AND ${table.cancellationReason} IS NULL)
  `),
  index("dispatch_guides_destination_issued_at_idx").on(table.destinationWorksiteId, table.issuedAt),
  index("dispatch_guides_status_idx").on(table.status),
  index("dispatch_guides_origin_idx").on(table.originWorksiteId),
  index("dispatch_guides_purchase_order_idx").on(table.purchaseOrderId),
  index("dispatch_guides_receipt_idx").on(table.receiptId),
])

/* ── Líneas de la guía ────────────────────────────────────────────────────────
 *
 * Sólo productos del catálogo: la guía no crea copias de productos ni acepta
 * texto libre, porque cada línea tiene que poder descontarse del stock de la
 * oficina. El índice único por (guía, producto) evita que la misma guía
 * descuente el mismo producto en dos líneas y con eso vuelva ambigua la
 * validación de stock.
 */
export const dispatchGuideItems = pgTable("dispatch_guide_items", {
  id:            text("id").primaryKey(),
  guideId:       text("guide_id").notNull().references(() => dispatchGuides.id, { onDelete: "cascade" }),
  productId:     text("product_id").notNull().references(() => products.id),
  purchaseOrderItemId: text("purchase_order_item_id").references(() => purchaseOrderItems.id),
  receiptItemId:       text("receipt_item_id").references(() => receiptItems.id),
  quantity:      real("quantity").notNull(),
  quantityReceived: real("quantity_received"),
  differenceReason: text("difference_reason"),
  unitOfMeasure: text("unit_of_measure").notNull().default("unidad"),
  notes:         text("notes"),
  sortOrder:     integer("sort_order").notNull().default(0),
}, (table) => [
  check("dispatch_guide_items_quantity_positive", sql`${table.quantity} > 0`),
  uniqueIndex("dispatch_guide_items_guide_product_unique").on(table.guideId, table.productId),
  index("dispatch_guide_items_guide_idx").on(table.guideId),
  index("dispatch_guide_items_po_item_idx").on(table.purchaseOrderItemId),
  index("dispatch_guide_items_receipt_item_idx").on(table.receiptItemId),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const dispatchGuidesRelations = relations(dispatchGuides, ({ one, many }) => ({
  originWorksite:      one(worksites, { relationName: "dispatch_guide_origin",      fields: [dispatchGuides.originWorksiteId],      references: [worksites.id] }),
  destinationWorksite: one(worksites, { relationName: "dispatch_guide_destination", fields: [dispatchGuides.destinationWorksiteId], references: [worksites.id] }),
  issuedByUser:        one(users,   { relationName: "dispatch_guide_issued_by",    fields: [dispatchGuides.issuedBy],     references: [users.id] }),
  dispatchedByUser:    one(users,   { relationName: "dispatch_guide_dispatched_by", fields: [dispatchGuides.dispatchedBy], references: [users.id] }),
  receivedByUser:      one(users,   { relationName: "dispatch_guide_received_by",  fields: [dispatchGuides.receivedBy],   references: [users.id] }),
  cancelledByUser:     one(users,   { relationName: "dispatch_guide_cancelled_by", fields: [dispatchGuides.cancelledBy],  references: [users.id] }),
  dispatcherWorker:    one(workers, { relationName: "dispatch_guide_dispatcher",   fields: [dispatchGuides.dispatcherWorkerId], references: [workers.id] }),
  receiverWorker:      one(workers, { relationName: "dispatch_guide_receiver",     fields: [dispatchGuides.receiverWorkerId],   references: [workers.id] }),
  receivedByWorker:    one(workers, { relationName: "dispatch_guide_received_by_worker", fields: [dispatchGuides.receivedByWorkerId], references: [workers.id] }),
  driverWorker:        one(workers, { relationName: "dispatch_guide_driver",       fields: [dispatchGuides.driverWorkerId],     references: [workers.id] }),
  vehicle:             one(fuelVehicles, { fields: [dispatchGuides.vehicleId], references: [fuelVehicles.id] }),
  purchaseOrder:       one(purchaseOrders, { fields: [dispatchGuides.purchaseOrderId], references: [purchaseOrders.id] }),
  receipt:             one(receipts, { fields: [dispatchGuides.receiptId], references: [receipts.id] }),
  items:               many(dispatchGuideItems),
}))

export const dispatchGuideItemsRelations = relations(dispatchGuideItems, ({ one }) => ({
  guide:   one(dispatchGuides, { fields: [dispatchGuideItems.guideId], references: [dispatchGuides.id] }),
  product: one(products, { fields: [dispatchGuideItems.productId], references: [products.id] }),
  purchaseOrderItem: one(purchaseOrderItems, { fields: [dispatchGuideItems.purchaseOrderItemId], references: [purchaseOrderItems.id] }),
  receiptItem: one(receiptItems, { fields: [dispatchGuideItems.receiptItemId], references: [receiptItems.id] }),
}))

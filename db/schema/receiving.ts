import { relations, sql } from "drizzle-orm"
import { pgTable, text, real, timestamp, check } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites, workers } from "./worksites"
import { products } from "./products"
import { purchaseOrders, purchaseOrderItems } from "./purchasing"
import { purchaseRequestItems } from "./requests"
import { costCenters } from "./cost-centers"

/* ── Receipts ─────────────────────────────────────────────────────────────── */
export const receipts = pgTable("receipts", {
  id:                 text("id").primaryKey(),
  code:               text("code").notNull().unique(),    // "REC-2026-0031"
  purchaseOrderId:    text("purchase_order_id").notNull().references(() => purchaseOrders.id),
  receivedBy:         text("received_by").notNull().references(() => users.id),
  receivedAt:         timestamp("received_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  // office: arrival at Chome office (checkpoint, no stock); faena: receipt at worksite (generates stock)
  locationType:       text("location_type").notNull().default("office"),
  worksiteId:         text("worksite_id").references(() => worksites.id),
  dispatchGuideNo:    text("dispatch_guide_no"),
  status:             text("status").notNull().default("open"),  // open | closed
  notes:              text("notes"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Invariant: locationType must be office or faena; status open or closed
  check("receipts_location_status_valid", sql`
    ${table.locationType} IN ('office', 'faena')
    AND ${table.status} IN ('open', 'closed')
  `),
])

/* ── Receipt Items ───────────────────────────────────────────────────────── */
export const receiptItems = pgTable("receipt_items", {
  id:                   text("id").primaryKey(),
  receiptId:            text("receipt_id").notNull().references(() => receipts.id, { onDelete: "cascade" }),
  purchaseOrderItemId:  text("purchase_order_item_id").notNull().references(() => purchaseOrderItems.id),
  quantityReceived:     real("quantity_received").notNull().default(0),
  quantityRejected:     real("quantity_rejected").notNull().default(0),
  quantityDamaged:      real("quantity_damaged").notNull().default(0),
  status:               text("status").notNull().default("received"),
  // received | partially_received | rejected | damaged | pending
  notes:                text("notes"),
}, (table) => [
  // Invariant: status from canonical receipt item lifecycle
  check("receipt_items_status_valid", sql`
    ${table.status} IN ('received', 'partially_received', 'rejected', 'damaged', 'pending')
  `),
  // Invariant: quantityReceived > 0; rejected/damaged counters non-negative
  check("receipt_items_quantities_valid", sql`
    ${table.quantityReceived} > 0
    AND ${table.quantityRejected} >= 0
    AND ${table.quantityDamaged} >= 0
  `),
])

/* ── Deliveries (Entregas a Faena / Trabajador) ──────────────────────────── */
export const deliveries = pgTable("deliveries", {
  id:              text("id").primaryKey(),
  code:            text("code").notNull().unique(),     // "ENT-2026-0019"
  deliveredBy:     text("delivered_by").notNull().references(() => users.id),
  deliveredAt:     timestamp("delivered_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  destinationType: text("destination_type").notNull(),  // "faena" | "worker"
  worksiteId:      text("worksite_id").references(() => worksites.id),
  costCenterId:    text("cost_center_id").references(() => costCenters.id),
  workerId:        text("worker_id").references(() => workers.id),
  receiverName:    text("receiver_name"),                // name of person who received
  receiverRut:     text("receiver_rut"),
  signaturePath:   text("signature_path"),               // optional signature image
  signedProofFileName: text("signed_proof_file_name"),
  signedProofPath: text("signed_proof_path"),
  notes:           text("notes"),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Invariant: destinationType must be faena (worksite-level delivery) or worker (individual delivery)
  check("deliveries_destination_type_valid", sql`${table.destinationType} IN ('faena', 'worker')`),
])

/* ── Delivery Items ───────────────────────────────────────────────────────── */
export const deliveryItems = pgTable("delivery_items", {
  id:               text("id").primaryKey(),
  deliveryId:       text("delivery_id").notNull().references(() => deliveries.id, { onDelete: "cascade" }),
  requestItemId:    text("request_item_id").references(() => purchaseRequestItems.id),
  productId:        text("product_id").references(() => products.id),
  productNameFree:  text("product_name_free"),
  quantity:         real("quantity").notNull(),
  unitOfMeasure:    text("unit_of_measure").notNull().default("unidad"),
  notes:            text("notes"),
  // Return of old/discarded EPP (opcional)
  returnQuantity:        real("return_quantity"),
  returnProductId:       text("return_product_id").references(() => products.id),
  returnProductNameFree: text("return_product_name_free"),
  returnReason:          text("return_reason"),   // desgastado | dañado | vencido | otro
  returnNotes:           text("return_notes"),
}, (table) => [
  // Invariant: delivered quantity must be strictly positive
  check("delivery_items_quantity_positive", sql`${table.quantity} > 0`),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const receiptsRelations = relations(receipts, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [receipts.purchaseOrderId], references: [purchaseOrders.id] }),
  receivedBy:    one(users, { fields: [receipts.receivedBy], references: [users.id] }),
  worksite:      one(worksites, { fields: [receipts.worksiteId], references: [worksites.id] }),
  items:         many(receiptItems),
}))

export const receiptItemsRelations = relations(receiptItems, ({ one }) => ({
  receipt:           one(receipts, { fields: [receiptItems.receiptId], references: [receipts.id] }),
  purchaseOrderItem: one(purchaseOrderItems, { fields: [receiptItems.purchaseOrderItemId], references: [purchaseOrderItems.id] }),
}))

export const deliveriesRelations = relations(deliveries, ({ one, many }) => ({
  deliveredBy: one(users, { fields: [deliveries.deliveredBy], references: [users.id] }),
  worksite:    one(worksites, { fields: [deliveries.worksiteId], references: [worksites.id] }),
  costCenter:  one(costCenters, { fields: [deliveries.costCenterId], references: [costCenters.id] }),
  worker:      one(workers, { fields: [deliveries.workerId], references: [workers.id] }),
  items:       many(deliveryItems),
}))

export const deliveryItemsRelations = relations(deliveryItems, ({ one }) => ({
  delivery: one(deliveries, { fields: [deliveryItems.deliveryId], references: [deliveries.id] }),
  requestItem: one(purchaseRequestItems, { fields: [deliveryItems.requestItemId], references: [purchaseRequestItems.id] }),
  product: one(products, { fields: [deliveryItems.productId], references: [products.id] }),
}))

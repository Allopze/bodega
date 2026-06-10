import { sqliteTable, text, real } from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"
import { users } from "./users"
import { worksites, workers } from "./worksites"
import { products } from "./products"
import { purchaseOrders, purchaseOrderItems } from "./purchasing"
import { purchaseRequestItems } from "./requests"

/* ── Receipts ─────────────────────────────────────────────────────────────── */
export const receipts = sqliteTable("receipts", {
  id:                 text("id").primaryKey(),
  code:               text("code").notNull().unique(),    // "REC-2026-0031"
  purchaseOrderId:    text("purchase_order_id").notNull().references(() => purchaseOrders.id),
  receivedBy:         text("received_by").notNull().references(() => users.id),
  receivedAt:         text("received_at").notNull().default(sql`(datetime('now'))`),
  // faena: always delivered directly to worksite
  locationType:       text("location_type").notNull().default("faena"),
  worksiteId:         text("worksite_id").references(() => worksites.id),
  dispatchGuideNo:    text("dispatch_guide_no"),
  status:             text("status").notNull().default("open"),  // open | closed
  notes:              text("notes"),
  createdAt:          text("created_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Receipt Items ───────────────────────────────────────────────────────── */
export const receiptItems = sqliteTable("receipt_items", {
  id:                   text("id").primaryKey(),
  receiptId:            text("receipt_id").notNull().references(() => receipts.id, { onDelete: "cascade" }),
  purchaseOrderItemId:  text("purchase_order_item_id").notNull().references(() => purchaseOrderItems.id),
  quantityReceived:     real("quantity_received").notNull().default(0),
  quantityRejected:     real("quantity_rejected").notNull().default(0),
  quantityDamaged:      real("quantity_damaged").notNull().default(0),
  status:               text("status").notNull().default("received"),
  // received | partially_received | rejected | damaged | pending
  notes:                text("notes"),
})

/* ── Deliveries (Entregas a Faena / Trabajador) ──────────────────────────── */
export const deliveries = sqliteTable("deliveries", {
  id:              text("id").primaryKey(),
  code:            text("code").notNull().unique(),     // "ENT-2026-0019"
  deliveredBy:     text("delivered_by").notNull().references(() => users.id),
  deliveredAt:     text("delivered_at").notNull().default(sql`(datetime('now'))`),
  destinationType: text("destination_type").notNull(),  // "faena" | "worker"
  worksiteId:      text("worksite_id").references(() => worksites.id),
  workerId:        text("worker_id").references(() => workers.id),
  receiverName:    text("receiver_name"),                // name of person who received
  signaturePath:   text("signature_path"),               // optional signature image
  notes:           text("notes"),
  createdAt:       text("created_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Delivery Items ───────────────────────────────────────────────────────── */
export const deliveryItems = sqliteTable("delivery_items", {
  id:               text("id").primaryKey(),
  deliveryId:       text("delivery_id").notNull().references(() => deliveries.id, { onDelete: "cascade" }),
  requestItemId:    text("request_item_id").references(() => purchaseRequestItems.id),
  productId:        text("product_id").references(() => products.id),
  productNameFree:  text("product_name_free"),
  quantity:         real("quantity").notNull(),
  unitOfMeasure:    text("unit_of_measure").notNull().default("unidad"),
  notes:            text("notes"),
})

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
  worker:      one(workers, { fields: [deliveries.workerId], references: [workers.id] }),
  items:       many(deliveryItems),
}))

export const deliveryItemsRelations = relations(deliveryItems, ({ one }) => ({
  delivery: one(deliveries, { fields: [deliveryItems.deliveryId], references: [deliveries.id] }),
  requestItem: one(purchaseRequestItems, { fields: [deliveryItems.requestItemId], references: [purchaseRequestItems.id] }),
  product: one(products, { fields: [deliveryItems.productId], references: [products.id] }),
}))

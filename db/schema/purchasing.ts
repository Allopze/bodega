import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"
import { users } from "./users"
import { worksites, suppliers } from "./worksites"
import { products } from "./products"
import { purchaseRequestItems } from "./requests"

/* ── Purchase Order States ───────────────────────────────────────────────── */
// draft | issued | sent | supplier_confirmed
// partially_received | received | partially_invoiced | invoiced
// reconciled | closed | cancelled

/* ── Purchase Orders ─────────────────────────────────────────────────────── */
export const purchaseOrders = sqliteTable("purchase_orders", {
  id:                text("id").primaryKey(),
  code:              text("code").notNull().unique(),   // "OC-2026-0017"
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id),
  supplierId:        text("supplier_id").notNull().references(() => suppliers.id),
  createdBy:         text("created_by").notNull().references(() => users.id),
  status:            text("status").notNull().default("draft"),
  issuedAt:          text("issued_at"),
  sentAt:            text("sent_at"),
  confirmedAt:       text("confirmed_at"),
  estimatedDelivery: text("estimated_delivery"),
  deliveryAddress:   text("delivery_address"),
  paymentTerms:      text("payment_terms"),
  netAmount:         real("net_amount").notNull().default(0),
  taxAmount:         real("tax_amount").notNull().default(0),
  totalAmount:       real("total_amount").notNull().default(0),
  notes:             text("notes"),
  supplierNotes:     text("supplier_notes"),
  createdAt:         text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt:         text("updated_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Purchase Order Items ─────────────────────────────────────────────────── */
export const purchaseOrderItems = sqliteTable("purchase_order_items", {
  id:                   text("id").primaryKey(),
  purchaseOrderId:      text("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  requestItemId:        text("request_item_id").references(() => purchaseRequestItems.id),
  productId:            text("product_id").references(() => products.id),
  productNameFree:      text("product_name_free"),      // for uncatalogued
  quantity:             real("quantity").notNull(),
  unitOfMeasure:        text("unit_of_measure").notNull().default("unidad"),
  unitPrice:            real("unit_price").notNull().default(0),
  discount:             real("discount").notNull().default(0),
  subtotal:             real("subtotal").notNull().default(0),
  quantityReceived:     real("quantity_received").notNull().default(0),
  status:               text("status").notNull().default("issued"),
  sortOrder:            integer("sort_order").notNull().default(0),
  notes:                text("notes"),
})

/* ── Quotations ───────────────────────────────────────────────────────────── */
export const quotations = sqliteTable("quotations", {
  id:              text("id").primaryKey(),
  purchaseOrderId: text("purchase_order_id").references(() => purchaseOrders.id),
  supplierId:      text("supplier_id").notNull().references(() => suppliers.id),
  fileName:        text("file_name"),
  filePath:        text("file_path"),
  amount:          real("amount"),
  validUntil:      text("valid_until"),
  notes:           text("notes"),
  uploadedBy:      text("uploaded_by").notNull().references(() => users.id),
  uploadedAt:      text("uploaded_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Relations ───────────────────────────────────────────────────────────── */
export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  worksite:   one(worksites, { fields: [purchaseOrders.worksiteId], references: [worksites.id] }),
  supplier:   one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  createdBy:  one(users, { fields: [purchaseOrders.createdBy], references: [users.id] }),
  items:      many(purchaseOrderItems),
  quotations: many(quotations),
}))

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [purchaseOrderItems.purchaseOrderId], references: [purchaseOrders.id] }),
  requestItem:   one(purchaseRequestItems, { fields: [purchaseOrderItems.requestItemId], references: [purchaseRequestItems.id] }),
  product:       one(products, { fields: [purchaseOrderItems.productId], references: [products.id] }),
}))

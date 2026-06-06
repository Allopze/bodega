import { sqliteTable, text, real } from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"
import { users } from "./users"
import { suppliers } from "./worksites"
import { products } from "./products"
import { purchaseOrders, purchaseOrderItems } from "./purchasing"

/* ── Invoice States ────────────────────────────────────────────────────────
   registered | pending_review | observed | reconciled
   rejected   | sent_to_payment | paid | cancelled
   ────────────────────────────────────────────────────────────────────────── */

export const invoices = sqliteTable("invoices", {
  id:                text("id").primaryKey(),
  code:              text("code").notNull().unique(),    // "FAC-2026-0008"
  supplierId:        text("supplier_id").notNull().references(() => suppliers.id),
  purchaseOrderId:   text("purchase_order_id").references(() => purchaseOrders.id),
  invoiceNumber:     text("invoice_number").notNull(),   // supplier's invoice number
  invoiceDate:       text("invoice_date").notNull(),
  netAmount:         real("net_amount").notNull().default(0),
  taxAmount:         real("tax_amount").notNull().default(0),
  totalAmount:       real("total_amount").notNull().default(0),
  status:            text("status").notNull().default("registered"),
  registeredBy:      text("registered_by").notNull().references(() => users.id),
  registeredAt:      text("registered_at").notNull().default(sql`(datetime('now'))`),
  reconciledBy:      text("reconciled_by").references(() => users.id),
  reconciledAt:      text("reconciled_at"),
  filePath:          text("file_path"),                  // uploaded PDF/XML
  notes:             text("notes"),
  createdAt:         text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt:         text("updated_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Invoice Items ────────────────────────────────────────────────────────── */
export const invoiceItems = sqliteTable("invoice_items", {
  id:                   text("id").primaryKey(),
  invoiceId:            text("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  purchaseOrderItemId:  text("purchase_order_item_id").references(() => purchaseOrderItems.id),
  productId:            text("product_id").references(() => products.id),
  productDescription:   text("product_description"),    // from invoice
  quantity:             real("quantity").notNull(),
  unitPrice:            real("unit_price").notNull(),
  subtotal:             real("subtotal").notNull(),
  notes:                text("notes"),
})

/* ── Invoice Reconciliation Differences ──────────────────────────────────── */
// type: qty_over | qty_under | price_diff | product_not_received | product_not_ordered
export const invoiceReconciliationDifferences = sqliteTable("invoice_reconciliation_differences", {
  id:               text("id").primaryKey(),
  invoiceId:        text("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  invoiceItemId:    text("invoice_item_id").references(() => invoiceItems.id),
  type:             text("type").notNull(),
  description:      text("description").notNull(),
  amountDifference: real("amount_difference"),
  qtyDifference:    real("qty_difference"),
  status:           text("status").notNull().default("pending"),  // pending | resolved | accepted
  resolvedBy:       text("resolved_by").references(() => users.id),
  resolvedAt:       text("resolved_at"),
  resolution:       text("resolution"),
  createdAt:        text("created_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Relations ───────────────────────────────────────────────────────────── */
export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  supplier:      one(suppliers, { fields: [invoices.supplierId], references: [suppliers.id] }),
  purchaseOrder: one(purchaseOrders, { fields: [invoices.purchaseOrderId], references: [purchaseOrders.id] }),
  registeredBy:  one(users, { fields: [invoices.registeredBy], references: [users.id] }),
  items:         many(invoiceItems),
  differences:   many(invoiceReconciliationDifferences),
}))

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice:           one(invoices, { fields: [invoiceItems.invoiceId], references: [invoices.id] }),
  purchaseOrderItem: one(purchaseOrderItems, { fields: [invoiceItems.purchaseOrderItemId], references: [purchaseOrderItems.id] }),
  product:           one(products, { fields: [invoiceItems.productId], references: [products.id] }),
}))

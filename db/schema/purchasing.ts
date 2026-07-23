import { relations, sql } from "drizzle-orm"
import { pgTable, text, integer, real, numeric, timestamp, check, index } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites, suppliers } from "./worksites"
import { products } from "./products"
import { purchaseRequestItems } from "./requests"
import { costCenters } from "./cost-centers"

/* ── Purchase Order States ───────────────────────────────────────────────── */
// draft | issued | sent | supplier_confirmed
// partially_office_received | office_received
// partially_received | received | closed | cancelled

/* ── Purchase Orders ─────────────────────────────────────────────────────── */
export const purchaseOrders = pgTable("purchase_orders", {
  id:                text("id").primaryKey(),
  code:              text("code").notNull().unique(),   // "OC-2026-0017"
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id),
  costCenterId:      text("cost_center_id").references(() => costCenters.id),
  supplierId:        text("supplier_id").notNull().references(() => suppliers.id),
  createdBy:         text("created_by").notNull().references(() => users.id),
  status:            text("status").notNull().default("draft"),
  issuedAt:          text("issued_at"),
  issuedBy:          text("issued_by").references(() => users.id),
  sentAt:            text("sent_at"),
  confirmedAt:       text("confirmed_at"),
  closedAt:          timestamp("closed_at", { withTimezone: true, mode: "string" }),
  estimatedDelivery: text("estimated_delivery"),
  deliveryAddress:   text("delivery_address"),
  paymentTerms:      text("payment_terms"),
  netAmount:         numeric("net_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  taxAmount:         numeric("tax_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  totalAmount:       numeric("total_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  notes:             text("notes"),
  supplierNotes:     text("supplier_notes"),
  deliveryMode:      text("delivery_mode").notNull().default("via_oficina"), // via_oficina | directo_faena — snapshot from request
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Invariant: status from canonical PO lifecycle; all monetary amounts non-negative
  check("purchase_orders_status_valid", sql`
    ${table.status} IN (
      'draft', 'issued', 'sent', 'supplier_confirmed',
      'partially_office_received', 'office_received',
      'partially_received', 'received', 'closed', 'cancelled'
    )
  `),
  check("purchase_orders_amounts_non_negative", sql`
    ${table.netAmount} >= 0
    AND ${table.taxAmount} >= 0
    AND ${table.totalAmount} >= 0
  `),
  check("purchase_orders_delivery_mode_valid", sql`
    ${table.deliveryMode} IN ('via_oficina', 'directo_faena')
  `),
  index("purchase_orders_worksite_status_idx").on(table.worksiteId, table.status, table.createdAt),
  index("purchase_orders_cost_center_idx").on(table.costCenterId),
  index("purchase_orders_status_sent_idx").on(table.status, table.sentAt),
])

/* ── Purchase Order Items ─────────────────────────────────────────────────── */
export const purchaseOrderItems = pgTable("purchase_order_items", {
  id:                   text("id").primaryKey(),
  purchaseOrderId:      text("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  requestItemId:        text("request_item_id").references(() => purchaseRequestItems.id),
  productId:            text("product_id").references(() => products.id),
  productNameFree:      text("product_name_free"),      // for uncatalogued
  quantity:             real("quantity").notNull(),
  unitOfMeasure:        text("unit_of_measure").notNull().default("unidad"),
  unitPrice:            numeric("unit_price", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  discount:             numeric("discount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  subtotal:             numeric("subtotal", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  quantityOfficeReceived: real("quantity_office_received").notNull().default(0),
  quantityReceived:     real("quantity_received").notNull().default(0),
  status:               text("status").notNull().default("issued"),
  sortOrder:            integer("sort_order").notNull().default(0),
  notes:                text("notes"),
}, (table) => [
  // Invariant: status from canonical PO item lifecycle
  check("purchase_order_items_status_valid", sql`
    ${table.status} IN ('issued', 'partially_received', 'received', 'cancelled')
  `),
  // Invariant: quantity > 0, unitPrice/subtotal >= 0, discount in 0-100,
  // and received counters are each bounded by quantity (0 <= qtyOfficeReceived <= qty,
  // 0 <= qtyReceived <= qty). Office no longer caps faena: the office-before-faena order
  // is enforced in app code only for via_oficina OCs (directo_faena skips the office stage).
  check("purchase_order_items_numeric_integrity", sql`
    ${table.quantity} > 0
    AND ${table.unitPrice} >= 0
    AND ${table.discount} >= 0
    AND ${table.discount} <= 100
    AND ${table.subtotal} >= 0
    AND ${table.quantityOfficeReceived} >= 0
    AND ${table.quantityReceived} >= 0
    AND ${table.quantityOfficeReceived} <= ${table.quantity}
    AND ${table.quantityReceived} <= ${table.quantity}
  `),
])

/* ── Quotations ───────────────────────────────────────────────────────────── */
export const quotations = pgTable("quotations", {
  id:              text("id").primaryKey(),
  purchaseOrderId: text("purchase_order_id").references(() => purchaseOrders.id),
  supplierId:      text("supplier_id").notNull().references(() => suppliers.id),
  fileName:        text("file_name"),
  filePath:        text("file_path"),
  amount:          numeric("amount", { precision: 12, scale: 2, mode: "number" }),
  validUntil:      text("valid_until"),
  notes:           text("notes"),
  uploadedBy:      text("uploaded_by").notNull().references(() => users.id),
  uploadedAt:      timestamp("uploaded_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

/* ── Purchase Order Invoices ──────────────────────────────────────────────── */
// Facturas del proveedor adjuntadas a una OC (N-a-1).
// Permite conciliación informativa: Σ amount vs purchase_orders.totalAmount.
export const purchaseOrderInvoices = pgTable("purchase_order_invoices", {
  id:              text("id").primaryKey(),
  purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  invoiceNumber:   text("invoice_number").notNull(),
  amount:          numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  issueDate:       text("issue_date"),                   // "YYYY-MM-DD" — consistent with other date fields
  fileName:        text("file_name").notNull(),
  filePath:        text("file_path").notNull(),           // relative: "storage/purchase-orders/<name>"
  fileSize:        integer("file_size"),
  mimeType:        text("mime_type"),
  uploadedBy:      text("uploaded_by").notNull().references(() => users.id),
  uploadedAt:      timestamp("uploaded_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("purchase_order_invoices_amount_non_negative", sql`${table.amount} >= 0`),
])

/* ── Purchase Order Invoice Items ─────────────────────────────────────────── */
// Ítems de factura vinculados a ítems de OC (N-a-1 con invoices, N-a-1 con OC items).
// Permite conciliación a nivel de ítem: invoice item ↔ purchase order item.
export const purchaseOrderInvoiceItems = pgTable("purchase_order_invoice_items", {
  id:                  text("id").primaryKey(),
  invoiceId:           text("invoice_id").notNull().references(() => purchaseOrderInvoices.id, { onDelete: "cascade" }),
  purchaseOrderItemId: text("purchase_order_item_id").references(() => purchaseOrderItems.id),
  productName:         text("product_name").notNull(),
  quantity:            real("quantity").notNull(),
  unitPrice:           numeric("unit_price", { precision: 12, scale: 2, mode: "number" }).notNull(),
  subtotal:            numeric("subtotal", { precision: 12, scale: 2, mode: "number" }).notNull(),
}, (table) => [
  check("po_invoice_items_qty_positive", sql`${table.quantity} > 0`),
  check("po_invoice_items_amounts_non_negative", sql`${table.unitPrice} >= 0 AND ${table.subtotal} >= 0`),
  index("po_invoice_items_invoice_idx").on(table.invoiceId),
  index("po_invoice_items_oc_item_idx").on(table.purchaseOrderItemId),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  worksite:   one(worksites, { fields: [purchaseOrders.worksiteId], references: [worksites.id] }),
  costCenter: one(costCenters, { fields: [purchaseOrders.costCenterId], references: [costCenters.id] }),
  supplier:   one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  createdBy:    one(users, { fields: [purchaseOrders.createdBy], references: [users.id], relationName: "po_created_by" }),
  issuedByUser: one(users, { fields: [purchaseOrders.issuedBy],  references: [users.id], relationName: "po_issued_by" }),
  items:      many(purchaseOrderItems),
  quotations: many(quotations),
  invoices:   many(purchaseOrderInvoices),
}))

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [purchaseOrderItems.purchaseOrderId], references: [purchaseOrders.id] }),
  requestItem:   one(purchaseRequestItems, { fields: [purchaseOrderItems.requestItemId], references: [purchaseRequestItems.id] }),
  product:       one(products, { fields: [purchaseOrderItems.productId], references: [products.id] }),
}))

export const purchaseOrderInvoicesRelations = relations(purchaseOrderInvoices, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [purchaseOrderInvoices.purchaseOrderId], references: [purchaseOrders.id] }),
  uploadedBy:    one(users, { fields: [purchaseOrderInvoices.uploadedBy], references: [users.id] }),
  items:         many(purchaseOrderInvoiceItems),
}))

export const purchaseOrderInvoiceItemsRelations = relations(purchaseOrderInvoiceItems, ({ one }) => ({
  invoice:           one(purchaseOrderInvoices, { fields: [purchaseOrderInvoiceItems.invoiceId], references: [purchaseOrderInvoices.id] }),
  purchaseOrderItem: one(purchaseOrderItems, { fields: [purchaseOrderInvoiceItems.purchaseOrderItemId], references: [purchaseOrderItems.id] }),
}))

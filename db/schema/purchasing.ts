import { relations, sql } from "drizzle-orm"
import { pgTable, text, integer, real, numeric, timestamp, check, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites, suppliers } from "./worksites"
import { products } from "./products"
import { purchaseRequestItems } from "./requests"
import { costCenters } from "./cost-centers"
import { dteDocumentItems } from "./purchase-invoice-matching"

/* ── Purchase Order States ───────────────────────────────────────────────── */
// draft | sent
// partially_office_received | office_received
// partially_received | received | closed | cancelled
//
// El status de purchase_order_items es un vocabulario aparte (ver el CHECK
// más abajo): sólo 'issued' (activo) | 'cancelled' — la recepción ahí se
// trackea con contadores numéricos, no con este status.

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
  deletedAt:         timestamp("deleted_at", { withTimezone: true, mode: "string" }),
  estimatedDelivery: text("estimated_delivery"),
  deliveryAddress:   text("delivery_address"),
  paymentTerms:      text("payment_terms"),
  netAmount:         numeric("net_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  taxAmount:         numeric("tax_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  totalAmount:       numeric("total_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  notes:             text("notes"),
  supplierNotes:     text("supplier_notes"),
  deliveryMode:      text("delivery_mode").notNull().default("via_oficina"), // via_oficina | directo_faena — snapshot from request
  invoiceReconciliationStatus: text("invoice_reconciliation_status").notNull().default("no_invoices"),
  invoiceReconciliationFingerprint: text("invoice_reconciliation_fingerprint"),
  invoiceReconciliationUpdatedAt: timestamp("invoice_reconciliation_updated_at", { withTimezone: true, mode: "string" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Invariant: status from canonical PO lifecycle; all monetary amounts non-negative
  check("purchase_orders_status_valid", sql`
    ${table.status} IN (
      'draft', 'sent',
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
  check("purchase_orders_invoice_reconciliation_status_valid", sql`
    ${table.invoiceReconciliationStatus} IN (
      'no_invoices', 'partially_invoiced', 'awaiting_receipt',
      'matched', 'needs_review', 'accepted_exception'
    )
  `),
  index("purchase_orders_worksite_status_idx").on(table.worksiteId, table.status, table.createdAt),
  index("purchase_orders_cost_center_idx").on(table.costCenterId),
  index("purchase_orders_status_sent_idx").on(table.status, table.sentAt),
  index("purchase_orders_invoice_reconciliation_idx").on(table.invoiceReconciliationStatus, table.status),
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
  /**
   * NULL = costo pendiente: la línea es un servicio cuyo precio todavía no se
   * conoce (mantención de monogás, calibración, vacuna). Es distinto de 0, que
   * significa "sin costo". `subtotal` acompaña siempre a `unitPrice`: o los dos
   * son NULL o los dos tienen valor (CHECK más abajo).
   */
  unitPrice:            numeric("unit_price", { precision: 12, scale: 2, mode: "number" }),
  discount:             numeric("discount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  subtotal:             numeric("subtotal", { precision: 12, scale: 2, mode: "number" }),
  /** Trazabilidad del costo registrado a posteriori (quién y cuándo). */
  costRecordedAt:       timestamp("cost_recorded_at", { withTimezone: true, mode: "string" }),
  costRecordedBy:       text("cost_recorded_by").references(() => users.id),
  quantityOfficeReceived: real("quantity_office_received").notNull().default(0),
  quantityReceived:     real("quantity_received").notNull().default(0),
  status:               text("status").notNull().default("issued"),
  sortOrder:            integer("sort_order").notNull().default(0),
  notes:                text("notes"),
}, (table) => [
  // Invariant: status from canonical PO item lifecycle.
  // ARQ-12: 'partially_received'/'received' no los escribe nadie — la
  // recepción se trackea con los contadores numéricos quantityOfficeReceived/
  // quantityReceived, no con este status. Sólo describe si la línea sigue
  // activa ('issued') o fue anulada ('cancelled').
  check("purchase_order_items_status_valid", sql`
    ${table.status} IN ('issued', 'cancelled')
  `),
  // Invariant: quantity > 0, unitPrice/subtotal >= 0 *cuando se conocen*, discount
  // in 0-100, and received counters are each bounded by quantity (0 <= qtyOfficeReceived <= qty,
  // 0 <= qtyReceived <= qty). Office no longer caps faena: the office-before-faena order
  // is enforced in app code only for via_oficina OCs (directo_faena skips the office stage).
  check("purchase_order_items_numeric_integrity", sql`
    ${table.quantity} > 0
    AND (${table.unitPrice} IS NULL OR ${table.unitPrice} >= 0)
    AND ${table.discount} >= 0
    AND ${table.discount} <= 100
    AND (${table.subtotal} IS NULL OR ${table.subtotal} >= 0)
    AND ${table.quantityOfficeReceived} >= 0
    AND ${table.quantityReceived} >= 0
    AND ${table.quantityOfficeReceived} <= ${table.quantity}
    AND ${table.quantityReceived} <= ${table.quantity}
  `),
  // Costo pendiente es un estado de la línea completa, no de una columna suelta:
  // un precio sin subtotal (o al revés) dejaría los totales de la OC sin cuadrar.
  check("purchase_order_items_cost_pending_pair", sql`
    (${table.unitPrice} IS NULL) = (${table.subtotal} IS NULL)
  `),
  // La trazabilidad del costo sólo tiene sentido con un costo ya registrado.
  check("purchase_order_items_cost_trace_requires_cost", sql`
    ${table.costRecordedAt} IS NULL OR ${table.unitPrice} IS NOT NULL
  `),
  // DAT-11: FK caliente sin índice — CASCADE de purchase_orders y el join más
  // frecuente del módulo (una fila por línea de cada OC).
  index("purchase_order_items_purchase_order_id_idx").on(table.purchaseOrderId),
  // DAT-11: join hacia atrás desde el ítem de OC a su solicitud de origen.
  index("purchase_order_items_request_item_id_idx").on(table.requestItemId),
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
}, (table) => [
  // DAT-11: FK sin índice.
  index("quotations_purchase_order_id_idx").on(table.purchaseOrderId),
])

/* ── Purchase Order Invoices ──────────────────────────────────────────────── */
// Facturas del proveedor adjuntadas a una OC (N-a-1).
// Permite conciliación informativa: Σ amount vs purchase_orders.totalAmount.
export const purchaseOrderInvoices = pgTable("purchase_order_invoices", {
  id:              text("id").primaryKey(),
  purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  invoiceNumber:   text("invoice_number").notNull(),
  /**
   * Qué clase de documento tributario es. Una nota de crédito **resta**: se
   * guarda con `amount` negativo, igual que `billing_invoices.total_amount`, y
   * así toda suma existente de montos de factura queda correcta sin conocer
   * esta columna. Medido sobre datos reales: 20 NC en dos meses, 4 de
   * proveedores con OC — el caso ocurre y hoy era irrepresentable.
   */
  documentKind:    text("document_kind").notNull().default("invoice").$type<"invoice" | "credit_note">(),
  amount:          numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  issueDate:       text("issue_date"),                   // "YYYY-MM-DD" — consistent with other date fields
  fileName:        text("file_name").notNull(),
  filePath:        text("file_path").notNull(),           // relative: "storage/purchase-orders/<name>"
  fileSize:        integer("file_size"),
  mimeType:        text("mime_type"),
  /** Identidad del emisor leída desde el documento, no desde el formulario. */
  documentSupplierRut: text("document_supplier_rut"),
  supplierIdentityStatus: text("supplier_identity_status").notNull().default("unknown"),
  supplierIdentitySource: text("supplier_identity_source").notNull().default("legacy"),
  uploadedBy:      text("uploaded_by").notNull().references(() => users.id),
  uploadedAt:      timestamp("uploaded_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),

  /**
   * Cómo llegó esta factura a colgar de esta OC. `legacy` es el default de las
   * filas anteriores a la columna: su origen no se puede reconstruir y decir
   * `manual_upload` sería inventarlo.
   */
  linkMethod:      text("link_method").notNull().default("legacy").$type<"legacy" | "manual_upload" | "dte_candidate">(),
  /**
   * Qué tan utilizable era la referencia de OC que el proveedor había escrito
   * en el XML **en el momento de vincular**. NULL cuando no hubo XML que mirar
   * (carga manual de un PDF) o cuando la fila es anterior a la columna.
   *
   * Se congela a propósito: es la evidencia de por qué se aceptó este vínculo,
   * no una vista del XML de hoy. La produce `classifyOrderReference`.
   */
  linkOrderReference: text("link_order_reference").$type<"exact" | "correlative" | "year" | "foreign" | "none">(),
}, (table) => [
  check("purchase_order_invoices_document_kind_valid", sql`
    ${table.documentKind} IN ('invoice', 'credit_note')
  `),
  // Relajar el signo para las NC no puede abrir la puerta a facturas negativas:
  // cada clase queda encerrada en el suyo.
  check("purchase_order_invoices_amount_sign_matches_kind", sql`
    (${table.documentKind} = 'invoice' AND ${table.amount} >= 0)
    OR (${table.documentKind} = 'credit_note' AND ${table.amount} <= 0)
  `),
  check("purchase_order_invoices_supplier_identity_status_valid", sql`
    ${table.supplierIdentityStatus} IN ('unknown', 'verified', 'unverified')
  `),
  check("purchase_order_invoices_supplier_identity_source_valid", sql`
    ${table.supplierIdentitySource} IN ('legacy', 'dte_xml', 'pdf_text', 'pdf_text_ocr', 'ocr', 'manual')
  `),
  check("purchase_order_invoices_link_method_valid", sql`
    ${table.linkMethod} IN ('legacy', 'manual_upload', 'dte_candidate')
  `),
  check("purchase_order_invoices_link_order_reference_valid", sql`
    ${table.linkOrderReference} IS NULL
    OR ${table.linkOrderReference} IN ('exact', 'correlative', 'year', 'foreign', 'none')
  `),
  // A folio is unique at least within its OC. The service also checks this
  // before insert for an operator-friendly error; this index closes races.
  uniqueIndex("purchase_order_invoices_order_number_unique")
    .on(table.purchaseOrderId, table.documentKind, table.invoiceNumber),
])

/* ── Purchase Order Invoice Items ─────────────────────────────────────────── */
// Ítems de factura vinculados a ítems de OC (N-a-1 con invoices, N-a-1 con OC items).
// Permite conciliación a nivel de ítem: invoice item ↔ purchase order item.
export const purchaseOrderInvoiceItems = pgTable("purchase_order_invoice_items", {
  id:                  text("id").primaryKey(),
  invoiceId:           text("invoice_id").notNull().references(() => purchaseOrderInvoices.id, { onDelete: "cascade" }),
  /**
   * Espejo de compatibilidad para consumidores 1:1 heredados. Las asignaciones
   * N:N son la autoridad desde purchase_order_invoice_item_allocations.
   */
  purchaseOrderItemId: text("purchase_order_item_id").references(() => purchaseOrderItems.id),
  sourceDteDocumentItemId: text("source_dte_document_item_id").references(() => dteDocumentItems.id, { onDelete: "set null" }),
  productName:         text("product_name").notNull(),
  productCode:         text("product_code"),
  // Unidad declarada por el documento. Null significa que el comprobante no la
  // informa; nunca se debe reemplazar silenciosamente por la unidad de la OC.
  unitOfMeasure:       text("unit_of_measure"),
  quantity:            real("quantity").notNull(),
  unitPrice:           numeric("unit_price", { precision: 12, scale: 2, mode: "number" }).notNull(),
  subtotal:            numeric("subtotal", { precision: 12, scale: 2, mode: "number" }).notNull(),
}, (table) => [
  // El signo lo hereda del documento: una NC guarda cantidades y subtotales
  // negativos para que las sumas del conciliador se netean solas. Lo que no
  // puede pasar es que discrepen entre sí, ni que una línea no mueva nada.
  check("po_invoice_items_qty_not_zero", sql`${table.quantity} <> 0`),
  check("po_invoice_items_sign_consistent", sql`
    (${table.quantity} > 0 AND ${table.subtotal} >= 0)
    OR (${table.quantity} < 0 AND ${table.subtotal} <= 0)
  `),
  check("po_invoice_items_unit_price_non_negative", sql`${table.unitPrice} >= 0`),
  index("po_invoice_items_invoice_idx").on(table.invoiceId),
  index("po_invoice_items_oc_item_idx").on(table.purchaseOrderItemId),
  index("po_invoice_items_source_dte_item_idx").on(table.sourceDteDocumentItemId),
])

/* ── Purchase Order Invoice Item Allocations ─────────────────────────────── */
export const purchaseOrderInvoiceItemAllocations = pgTable(
  "purchase_order_invoice_item_allocations",
  {
    id: text("id").primaryKey(),
    invoiceItemId: text("invoice_item_id").notNull()
      .references(() => purchaseOrderInvoiceItems.id, { onDelete: "cascade" }),
    purchaseOrderItemId: text("purchase_order_item_id").notNull()
      .references(() => purchaseOrderItems.id, { onDelete: "cascade" }),
    quantity: real("quantity").notNull(),
    subtotal: numeric("subtotal", { precision: 12, scale: 2, mode: "number" }).notNull(),
    source: text("source").notNull().$type<"legacy_backfill" | "operator" | "dte_suggestion">(),
    createdBy: text("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("po_invoice_item_allocations_quantity_nonzero", sql`${table.quantity} <> 0`),
    check("po_invoice_item_allocations_sign_consistent", sql`
      (${table.quantity} > 0 AND ${table.subtotal} >= 0)
      OR (${table.quantity} < 0 AND ${table.subtotal} <= 0)
    `),
    check("po_invoice_item_allocations_source_valid", sql`
      ${table.source} IN ('legacy_backfill', 'operator', 'dte_suggestion')
    `),
    uniqueIndex("po_invoice_item_allocations_pair_unique")
      .on(table.invoiceItemId, table.purchaseOrderItemId),
    index("po_invoice_item_allocations_oc_item_idx").on(table.purchaseOrderItemId),
  ],
)

/* ── Purchase Order Invoice Reconciliation Reviews ───────────────────────── */
export const purchaseOrderInvoiceReconciliationReviews = pgTable("purchase_order_invoice_reconciliation_reviews", {
  id:              text("id").primaryKey(),
  purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  fingerprint:     text("fingerprint").notNull(),
  reason:          text("reason").notNull(),
  evidence:        jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  reviewedBy:      text("reviewed_by").notNull().references(() => users.id),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("po_invoice_reconciliation_reviews_reason_length", sql`char_length(${table.reason}) BETWEEN 10 AND 1000`),
  uniqueIndex("po_invoice_reconciliation_reviews_order_fingerprint_unique").on(table.purchaseOrderId, table.fingerprint),
  index("po_invoice_reconciliation_reviews_order_created_idx").on(table.purchaseOrderId, table.createdAt),
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
  invoiceReconciliationReviews: many(purchaseOrderInvoiceReconciliationReviews),
}))

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [purchaseOrderItems.purchaseOrderId], references: [purchaseOrders.id] }),
  requestItem:   one(purchaseRequestItems, { fields: [purchaseOrderItems.requestItemId], references: [purchaseRequestItems.id] }),
  product:       one(products, { fields: [purchaseOrderItems.productId], references: [products.id] }),
  costRecordedByUser: one(users, { fields: [purchaseOrderItems.costRecordedBy], references: [users.id] }),
  allocations: many(purchaseOrderInvoiceItemAllocations),
}))

export const purchaseOrderInvoicesRelations = relations(purchaseOrderInvoices, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [purchaseOrderInvoices.purchaseOrderId], references: [purchaseOrders.id] }),
  uploadedBy:    one(users, { fields: [purchaseOrderInvoices.uploadedBy], references: [users.id] }),
  items:         many(purchaseOrderInvoiceItems),
}))

export const purchaseOrderInvoiceItemsRelations = relations(purchaseOrderInvoiceItems, ({ one, many }) => ({
  invoice:           one(purchaseOrderInvoices, { fields: [purchaseOrderInvoiceItems.invoiceId], references: [purchaseOrderInvoices.id] }),
  purchaseOrderItem: one(purchaseOrderItems, { fields: [purchaseOrderInvoiceItems.purchaseOrderItemId], references: [purchaseOrderItems.id] }),
  allocations:       many(purchaseOrderInvoiceItemAllocations),
}))

export const purchaseOrderInvoiceItemAllocationsRelations = relations(purchaseOrderInvoiceItemAllocations, ({ one }) => ({
  invoiceItem: one(purchaseOrderInvoiceItems, {
    fields: [purchaseOrderInvoiceItemAllocations.invoiceItemId],
    references: [purchaseOrderInvoiceItems.id],
  }),
  purchaseOrderItem: one(purchaseOrderItems, {
    fields: [purchaseOrderInvoiceItemAllocations.purchaseOrderItemId],
    references: [purchaseOrderItems.id],
  }),
  createdByUser: one(users, {
    fields: [purchaseOrderInvoiceItemAllocations.createdBy],
    references: [users.id],
  }),
}))

export const purchaseOrderInvoiceReconciliationReviewsRelations = relations(purchaseOrderInvoiceReconciliationReviews, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [purchaseOrderInvoiceReconciliationReviews.purchaseOrderId], references: [purchaseOrders.id] }),
  reviewedByUser: one(users, { fields: [purchaseOrderInvoiceReconciliationReviews.reviewedBy], references: [users.id] }),
}))

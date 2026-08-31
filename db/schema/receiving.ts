import { relations, sql } from "drizzle-orm"
import { pgTable, text, real, timestamp, check, index, uniqueIndex, jsonb, primaryKey } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites, workers } from "./worksites"
import { products } from "./products"
import { purchaseOrderInvoices, purchaseOrders, purchaseOrderItems } from "./purchasing"
import { purchaseRequestItems } from "./requests"
import { costCenters } from "./cost-centers"

/* ── Receipts ─────────────────────────────────────────────────────────────── */
export const receipts = pgTable("receipts", {
  id:                 text("id").primaryKey(),
  code:               text("code").notNull().unique(),    // "REC-2026-0031"
  purchaseOrderId:    text("purchase_order_id").notNull().references(() => purchaseOrders.id),
  receivedBy:         text("received_by").notNull().references(() => users.id),
  receivedAt:         timestamp("received_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  // office: arrival at Chome office; faena: final receipt at destination worksite
  locationType:       text("location_type").notNull().default("office"),
  worksiteId:         text("worksite_id").references(() => worksites.id),
  dispatchGuideNo:    text("dispatch_guide_no"),
  status:             text("status").notNull().default("open"),  // open | closed
  notes:              text("notes"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("receipts_location_status_valid", sql`
    ${table.locationType} IN ('office', 'faena')
    AND ${table.status} IN ('open', 'closed')
  `),
  index("idx_receipts_po").on(table.purchaseOrderId),
])

/* ── Receipt Items ───────────────────────────────────────────────────────── */
export const receiptItems = pgTable("receipt_items", {
  id:                   text("id").primaryKey(),
  receiptId:            text("receipt_id").notNull().references(() => receipts.id, { onDelete: "cascade" }),
  purchaseOrderItemId:  text("purchase_order_item_id").notNull().references(() => purchaseOrderItems.id),
  quantityReceived:     real("quantity_received").notNull().default(0),
  quantityRejected:     real("quantity_rejected").notNull().default(0),
  quantityDamaged:      real("quantity_damaged").notNull().default(0),
  /** Faltante/diferencia detectada al cotejar una GDI en faena. */
  quantityDifference:   real("quantity_difference").notNull().default(0),
  status:               text("status").notNull().default("received"),
  // received | partially_received | rejected | damaged | pending
  notes:                text("notes"),
}, (table) => [
  // Invariant: status from canonical receipt item lifecycle
  check("receipt_items_status_valid", sql`
    ${table.status} IN ('received', 'partially_received', 'rejected', 'damaged', 'pending')
  `),
  // Invariant: contadores no negativos y al menos uno positivo. quantityReceived
  // puede ser 0 cuando la línea llegó 100% rechazada/dañada (M-3).
  check("receipt_items_quantities_valid", sql`
    ${table.quantityReceived} >= 0
    AND ${table.quantityRejected} >= 0
    AND ${table.quantityDamaged} >= 0
    AND ${table.quantityDifference} >= 0
    AND (${table.quantityReceived} + ${table.quantityRejected} + ${table.quantityDamaged} + ${table.quantityDifference}) > 0
  `),
  index("idx_receipt_items_po_item").on(table.purchaseOrderItemId),
  // DAT-11: FK caliente sin índice — CASCADE de receipts.
  index("idx_receipt_items_receipt").on(table.receiptId),
])

/* ── Purchase invoice ↔ supplier receipt links ───────────────────────────── */
// Vínculo documental opcional. Las cantidades se concilian acumuladas por
// línea de OC; esta tabla no reparte unidades entre factura y recepción.
export const purchaseOrderInvoiceReceipts = pgTable("purchase_order_invoice_receipts", {
  invoiceId: text("invoice_id").notNull().references(() => purchaseOrderInvoices.id, { onDelete: "cascade" }),
  receiptId: text("receipt_id").notNull().references(() => receipts.id, { onDelete: "cascade" }),
  linkedBy:  text("linked_by").notNull().references(() => users.id),
  linkedAt:  timestamp("linked_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.invoiceId, table.receiptId] }),
  index("po_invoice_receipts_receipt_idx").on(table.receiptId),
])

/* ── Deliveries (Entregas a Faena / Trabajador) ──────────────────────────── */
export const deliveries = pgTable("deliveries", {
  id:              text("id").primaryKey(),
  code:            text("code").notNull().unique(),     // "ENT-2026-0019"
  deliveredBy:     text("delivered_by").notNull().references(() => users.id),
  deliveredAt:     timestamp("delivered_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  destinationType: text("destination_type").notNull(),  // "faena" | "worker"
  // The stock location from which the goods actually leave. Historical
  // deliveries keep this null because their source cannot be inferred safely.
  sourceWorksiteId: text("source_worksite_id").references(() => worksites.id),
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
  check("deliveries_destination_type_valid", sql`${table.destinationType} IN ('faena', 'worker')`),
  index("idx_deliveries_worksite_date").on(table.worksiteId, table.deliveredAt),
  index("idx_deliveries_source_worksite_date").on(table.sourceWorksiteId, table.deliveredAt),
])

/* ── Delivery Items ───────────────────────────────────────────────────────── */
export const deliveryItems = pgTable("delivery_items", {
  id:               text("id").primaryKey(),
  deliveryId:       text("delivery_id").notNull().references(() => deliveries.id, { onDelete: "cascade" }),
  requestItemId:    text("request_item_id").references(() => purchaseRequestItems.id),
  productId:        text("product_id").references(() => products.id),
  productNameFree:  text("product_name_free"),
  quantity:         real("quantity").notNull(),
  // Correcciones automáticas conservan el valor defectuoso en vez de borrar la
  // evidencia. `quantity` queda como la cantidad operacional efectiva y estas
  // columnas documentan qué se recibió originalmente y por qué cambió.
  quantityOriginal: real("quantity_original"),
  quantityCorrectedAt: timestamp("quantity_corrected_at", { withTimezone: true, mode: "string" }),
  quantityCorrectionReason: text("quantity_correction_reason"),
  unitOfMeasure:    text("unit_of_measure").notNull().default("unidad"),
  notes:            text("notes"),
  // Return of old/discarded EPP (opcional)
  returnQuantity:        real("return_quantity"),
  returnProductId:       text("return_product_id").references(() => products.id),
  returnProductNameFree: text("return_product_name_free"),
  returnReason:          text("return_reason"),   // desgastado | dañado | vencido | otro
  returnNotes:           text("return_notes"),
}, (table) => [
  check("delivery_items_quantity_positive", sql`${table.quantity} > 0`),
  check("delivery_items_quantity_correction_valid", sql`
    (${table.quantityOriginal} IS NULL
      AND ${table.quantityCorrectedAt} IS NULL
      AND ${table.quantityCorrectionReason} IS NULL)
    OR
    (${table.quantityOriginal} > 0
      AND ${table.quantityCorrectedAt} IS NOT NULL
      AND char_length(trim(${table.quantityCorrectionReason})) > 0)
  `),
  index("idx_delivery_items_request").on(table.requestItemId),
  // DAT-11: FK caliente sin índice — CASCADE de deliveries.
  index("idx_delivery_items_delivery").on(table.deliveryId),
])

/* ── Historical traceability integrity ───────────────────────────────────── */
// A finding never changes the operational history it observed. Resolution is a
// second append-only event so the original snapshot stays auditable.
export const traceabilityIntegrityCases = pgTable("traceability_integrity_cases", {
  id:            text("id").primaryKey(),
  findingKey:    text("finding_key").notNull(),
  requestItemId: text("request_item_id").notNull().references(() => purchaseRequestItems.id),
  worksiteId:    text("worksite_id").notNull().references(() => worksites.id),
  findingCode:   text("finding_code").notNull(),
  snapshot:      jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  detectedAt:    timestamp("detected_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("traceability_integrity_case_code_valid", sql`
    ${table.findingCode} IN ('DELIVERY_EXCEEDS_FAENA_RECEIPT', 'DELIVERY_BEFORE_FAENA_RECEIPT')
  `),
  uniqueIndex("traceability_integrity_cases_finding_key_unique").on(table.findingKey),
  index("traceability_integrity_cases_worksite_detected_at_idx").on(table.worksiteId, table.detectedAt),
  index("traceability_integrity_cases_request_item_idx").on(table.requestItemId),
])

export const traceabilityIntegrityResolutions = pgTable("traceability_integrity_resolutions", {
  id:                      text("id").primaryKey(),
  caseId:                  text("case_id").notNull().references(() => traceabilityIntegrityCases.id),
  action:                  text("action").notNull(),
  reason:                  text("reason").notNull(),
  compensatingMovementId:  text("compensating_movement_id"),
  resolvedBy:              text("resolved_by").notNull().references(() => users.id),
  createdAt:               timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("traceability_integrity_resolution_action_valid", sql`
    ${table.action} IN ('acknowledge', 'compensating_movement')
  `),
  check("traceability_integrity_resolution_reason_length", sql`
    char_length(trim(${table.reason})) BETWEEN 10 AND 2000
  `),
  check("traceability_integrity_resolution_movement_required", sql`
    (${table.action} = 'acknowledge' AND ${table.compensatingMovementId} IS NULL)
    OR (${table.action} = 'compensating_movement' AND ${table.compensatingMovementId} IS NOT NULL)
  `),
  // Un solo cierre por caso evita dobles regularizaciones concurrentes sin
  // sobrescribir el evento original.
  uniqueIndex("traceability_integrity_resolutions_case_unique").on(table.caseId),
  index("traceability_integrity_resolutions_created_at_idx").on(table.createdAt),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const receiptsRelations = relations(receipts, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [receipts.purchaseOrderId], references: [purchaseOrders.id] }),
  receivedBy:    one(users, { fields: [receipts.receivedBy], references: [users.id] }),
  worksite:      one(worksites, { fields: [receipts.worksiteId], references: [worksites.id] }),
  items:         many(receiptItems),
  invoiceLinks:  many(purchaseOrderInvoiceReceipts),
}))

export const receiptItemsRelations = relations(receiptItems, ({ one }) => ({
  receipt:           one(receipts, { fields: [receiptItems.receiptId], references: [receipts.id] }),
  purchaseOrderItem: one(purchaseOrderItems, { fields: [receiptItems.purchaseOrderItemId], references: [purchaseOrderItems.id] }),
}))

export const purchaseOrderInvoiceReceiptsRelations = relations(purchaseOrderInvoiceReceipts, ({ one }) => ({
  invoice: one(purchaseOrderInvoices, {
    fields: [purchaseOrderInvoiceReceipts.invoiceId],
    references: [purchaseOrderInvoices.id],
  }),
  receipt: one(receipts, {
    fields: [purchaseOrderInvoiceReceipts.receiptId],
    references: [receipts.id],
  }),
  linkedByUser: one(users, {
    fields: [purchaseOrderInvoiceReceipts.linkedBy],
    references: [users.id],
  }),
}))

export const deliveriesRelations = relations(deliveries, ({ one, many }) => ({
  deliveredBy: one(users, { fields: [deliveries.deliveredBy], references: [users.id] }),
  worksite:    one(worksites, {
    relationName: "delivery_destination_worksite",
    fields: [deliveries.worksiteId],
    references: [worksites.id],
  }),
  sourceWorksite: one(worksites, {
    relationName: "delivery_source_worksite",
    fields: [deliveries.sourceWorksiteId],
    references: [worksites.id],
  }),
  costCenter:  one(costCenters, { fields: [deliveries.costCenterId], references: [costCenters.id] }),
  worker:      one(workers, { fields: [deliveries.workerId], references: [workers.id] }),
  items:       many(deliveryItems),
}))

export const deliveryItemsRelations = relations(deliveryItems, ({ one }) => ({
  delivery: one(deliveries, { fields: [deliveryItems.deliveryId], references: [deliveries.id] }),
  requestItem: one(purchaseRequestItems, { fields: [deliveryItems.requestItemId], references: [purchaseRequestItems.id] }),
  product: one(products, { fields: [deliveryItems.productId], references: [products.id] }),
}))

export const traceabilityIntegrityCasesRelations = relations(traceabilityIntegrityCases, ({ one, many }) => ({
  requestItem: one(purchaseRequestItems, { fields: [traceabilityIntegrityCases.requestItemId], references: [purchaseRequestItems.id] }),
  worksite: one(worksites, { fields: [traceabilityIntegrityCases.worksiteId], references: [worksites.id] }),
  resolutions: many(traceabilityIntegrityResolutions),
}))

export const traceabilityIntegrityResolutionsRelations = relations(traceabilityIntegrityResolutions, ({ one }) => ({
  case: one(traceabilityIntegrityCases, { fields: [traceabilityIntegrityResolutions.caseId], references: [traceabilityIntegrityCases.id] }),
  resolvedByUser: one(users, { fields: [traceabilityIntegrityResolutions.resolvedBy], references: [users.id] }),
}))

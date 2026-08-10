import { relations, sql } from "drizzle-orm"
import { pgTable, text, integer, real, timestamp, index, uniqueIndex, check, type AnyPgColumn } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites, workers, suppliers } from "./worksites"
import { products, productAttributes } from "./products"
import { costCenters } from "./cost-centers"
import { eppTypes } from "./epp-types"
import { serviceEquipment } from "./service-equipment"

/* ── Purchase Request States ─────────────────────────────────────────────── */
// draft | submitted | in_review | partially_approved | approved
// rejected | returned | in_purchasing | closed | cancelled

/* ── Request Item States (the core lifecycle) ────────────────────────────── */
// draft | requested | approved | rejected | returned | postponed
// pending_purchase | in_purchase_order | purchased
// partially_received | received | partially_delivered | delivered

/* ── Purchase Requests ───────────────────────────────────────────────────── */
export const purchaseRequests = pgTable("purchase_requests", {
  id:           text("id").primaryKey(),
  code:         text("code").notNull().unique(),    // e.g. "SOL-0042"
  worksiteId:   text("worksite_id").notNull().references(() => worksites.id),
  costCenterId: text("cost_center_id").references(() => costCenters.id),
  requesterId:  text("requester_id").notNull().references(() => users.id),

  requestType:  text("request_type").notNull().default("epp"), // epp | otro | repuestos | servicios
  urgency:      text("urgency").notNull().default("normal"),   // normal | high | critical
  requiredDate: text("required_date"),
  status:       text("status").notNull().default("draft"),
  submittedAt:  text("submitted_at"),
  closedAt:     text("closed_at"),
  notes:        text("notes"),
  deliveryMode: text("delivery_mode").notNull().default("via_oficina"), // via_oficina | directo_faena
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Invariant: requestType, urgency and status must be from the canonical lists.
  // 'returned' se retiró del flujo (2026-08-07, ARQ-5): ya estaba excluido de
  // la guarda del rollup (F1-1c) — ningún tipo de solicitud puede producirlo.
  check("purchase_requests_type_urgency_status_valid", sql`
    ${table.requestType} IN ('epp', 'otro', 'repuestos', 'servicios')
    AND ${table.urgency} IN ('normal', 'high', 'critical')
    AND ${table.status} IN (
      'draft', 'submitted', 'in_review', 'partially_approved', 'approved',
      'rejected', 'in_purchasing', 'closed', 'cancelled'
    )
  `),
  check("purchase_requests_delivery_mode_valid", sql`
    ${table.deliveryMode} IN ('via_oficina', 'directo_faena')
  `),
  index("purchase_requests_worksite_id_status_idx").on(table.worksiteId, table.status),
  index("purchase_requests_cost_center_idx").on(table.costCenterId),
  index("purchase_requests_requester_id_created_at_idx").on(table.requesterId, table.createdAt),
])

/* ── Purchase Request Items ───────────────────────────────────────────────── */
export const purchaseRequestItems = pgTable("purchase_request_items", {
  id:             text("id").primaryKey(),
  requestId:      text("request_id").notNull().references(() => purchaseRequests.id, { onDelete: "cascade" }),
  productId:      text("product_id").references(() => products.id),
  // For uncatalogued products:
  productNameFree: text("product_name_free"),
  quantity:        real("quantity").notNull(),
  unitOfMeasure:   text("unit_of_measure").notNull().default("unidad"),
  status:          text("status").notNull().default("draft"),
  urgency:         text("urgency"),
  requiredDate:    text("required_date"),
  workerId:        text("worker_id").references(() => workers.id),  // EPP → specific worker
  // Servicios sobre un instrumento del registro (monogás, alcotest): la
  // solicitud apunta al equipo en vez de copiar su código y número de serie.
  equipmentId:     text("equipment_id").references(() => serviceEquipment.id),
  // Supplier hint (mirrors productId / productNameFree pattern)
  suggestedSupplierId: text("suggested_supplier_id").references(() => suppliers.id),
  supplierHint:    text("supplier_hint"),                           // free-text fallback
  sortOrder:       integer("sort_order").notNull().default(0),
  notes:           text("notes"),
  splitFromItemId: text("split_from_item_id").references((): AnyPgColumn => purchaseRequestItems.id, { onDelete: "set null" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Invariant: quantity must be strictly positive; status from canonical item lifecycle
  // urgency is nullable (inherits from request by default), but when set must be from the canonical list
  check("purchase_request_items_quantity_positive", sql`${table.quantity} > 0`),
  // 'postponed' y 'returned' se retiraron del flujo (2026-08-07): postergar
  // dejó de existir (los ítems que lo tenían migraron a 'pending_purchase'), y
  // devolver ya estaba muerto para repuestos/servicios desde el 2026-07-29
  // (excluidos de la cola de aprobación por-ítem) — con `returnItem` eliminado
  // hoy, ningún tipo de solicitud puede producirlo. 'draft' sigue vivo, pero
  // sólo lo producen repuestos/servicios.
  check("purchase_request_items_state_valid", sql`
    ${table.status} IN (
      'draft', 'requested', 'approved', 'rejected',
      'pending_purchase', 'in_purchase_order', 'purchased',
      'partially_received', 'received', 'partially_delivered', 'delivered'
    )
    AND (${table.urgency} IS NULL OR ${table.urgency} IN ('normal', 'high', 'critical'))
  `),
  index("purchase_request_items_request_id_status_idx").on(table.requestId, table.status),
  // Historial por equipo: "qué mantenciones lleva este monogás".
  index("purchase_request_items_equipment_idx").on(table.equipmentId),
])

/* ── Request Item Attributes (talla, color, medida, etc.) ────────────────── */
export const requestItemAttributes = pgTable("request_item_attributes", {
  id:              text("id").primaryKey(),
  requestItemId:   text("request_item_id").notNull().references(() => purchaseRequestItems.id, { onDelete: "cascade" }),
  attributeId:     text("attribute_id").references(() => productAttributes.id),
  attributeName:   text("attribute_name").notNull(),  // denormalized for free-text items
  value:           text("value").notNull(),
}, (table) => [
  uniqueIndex("uq_request_item_attributes_name").on(table.requestItemId, table.attributeName),
  check("request_item_attributes_value_length", sql`char_length(${table.value}) > 0 AND char_length(${table.value}) <= 64`),
])

/* ── Automatic EPP replenishment idempotency ─────────────────────────────── */
// A link stays open while a concrete coverage gap is being replenished. The
// partial unique index is the concurrency boundary: two repeated clicks (or
// workers) cannot create two request items for the same live gap.
export const eppReplenishmentLinks = pgTable("epp_replenishment_links", {
  id:                text("id").primaryKey(),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  workerId:          text("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  eppTypeId:         text("epp_type_id").notNull().references(() => eppTypes.id),
  requirementId:     text("requirement_id").notNull(),
  gapVersion:        text("gap_version").notNull(),
  requestItemId:     text("request_item_id").references(() => purchaseRequestItems.id, { onDelete: "set null" }),
  resolvedAt:        timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("epp_replenishment_links_open_gap_unique")
    .on(table.worksiteId, table.workerId, table.eppTypeId, table.requirementId, table.gapVersion)
    .where(sql`${table.resolvedAt} IS NULL`),
  index("epp_replenishment_links_request_item_idx").on(table.requestItemId),
])

/* ── Approval Decisions ───────────────────────────────────────────────────── */
export const approvalDecisions = pgTable("approval_decisions", {
  id:             text("id").primaryKey(),
  requestItemId:  text("request_item_id").references(() => purchaseRequestItems.id),
  requestId:      text("request_id").references(() => purchaseRequests.id),
  type:           text("type").notNull(),            // approve | reject | return | modify
  decidedBy:      text("decided_by").notNull().references(() => users.id),
  decidedAt:      timestamp("decided_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  reason:         text("reason"),
  modifiedQty:    real("modified_qty"),              // if quantity was modified during approval
  roleContext:    text("role_context"),               // 'jefa_chome' | 'secretaria' | 'prevencionista' | 'jefe_mantencion' | 'admin'
}, (table) => [
  check("approval_decisions_modified_qty_positive", sql`${table.modifiedQty} IS NULL OR ${table.modifiedQty} > 0`),
  check("approval_decisions_type_valid", sql`${table.type} IN ('approve', 'reject', 'return', 'modify')`),
  index("idx_approval_decisions_item").on(table.requestItemId),
  // DAT-11: FK sin índice.
  index("idx_approval_decisions_request").on(table.requestId),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const purchaseRequestsRelations = relations(purchaseRequests, ({ one, many }) => ({
  worksite:   one(worksites, { fields: [purchaseRequests.worksiteId], references: [worksites.id] }),
  costCenter: one(costCenters, { fields: [purchaseRequests.costCenterId], references: [costCenters.id] }),
  requester:  one(users, { fields: [purchaseRequests.requesterId], references: [users.id] }),
  items:      many(purchaseRequestItems),
}))

export const purchaseRequestItemsRelations = relations(purchaseRequestItems, ({ one, many }) => ({
  request:           one(purchaseRequests, { fields: [purchaseRequestItems.requestId], references: [purchaseRequests.id] }),
  product:           one(products, { fields: [purchaseRequestItems.productId], references: [products.id] }),
  worker:            one(workers, { fields: [purchaseRequestItems.workerId], references: [workers.id] }),
  equipment:         one(serviceEquipment, { fields: [purchaseRequestItems.equipmentId], references: [serviceEquipment.id] }),
  suggestedSupplier: one(suppliers, { fields: [purchaseRequestItems.suggestedSupplierId], references: [suppliers.id] }),
  attributes:        many(requestItemAttributes),
  approvalDecisions: many(approvalDecisions),
}))

export const eppReplenishmentLinksRelations = relations(eppReplenishmentLinks, ({ one }) => ({
  worksite:    one(worksites, { fields: [eppReplenishmentLinks.worksiteId], references: [worksites.id] }),
  worker:      one(workers, { fields: [eppReplenishmentLinks.workerId], references: [workers.id] }),
  eppType:     one(eppTypes, { fields: [eppReplenishmentLinks.eppTypeId], references: [eppTypes.id] }),
  requestItem: one(purchaseRequestItems, { fields: [eppReplenishmentLinks.requestItemId], references: [purchaseRequestItems.id] }),
}))

export const requestItemAttributesRelations = relations(requestItemAttributes, ({ one }) => ({
  requestItem: one(purchaseRequestItems, {
    fields:     [requestItemAttributes.requestItemId],
    references: [purchaseRequestItems.id],
  }),
  attribute: one(productAttributes, {
    fields:     [requestItemAttributes.attributeId],
    references: [productAttributes.id],
  }),
}))

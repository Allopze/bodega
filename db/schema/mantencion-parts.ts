import { relations, sql } from "drizzle-orm"
import { boolean, check, foreignKey, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core"
import { fuelVehicles } from "./fuel-vehicles"
import { users } from "./users"
import { worksites } from "./worksites"
import { products } from "./products"
import { mantWorkOrders } from "./mantencion-work-orders"
import { purchaseRequestItems } from "./requests"
import { receipts } from "./receiving"
import { dispatchGuides } from "./dispatch-guides"

/**
 * Repuestos de mantención con stock (ADR `docs/mantencion/adr/0001-…`, 2026-11-26).
 *
 * - **Nota de pedido (NP):** el mecánico pide repuestos para una OT desde la app.
 *   Jefatura resuelve cada línea: desde el stock de la faena, comprando (la
 *   solicitud de compra apunta a la línea con `purchase_request_items.parts_note_item_id`)
 *   o rechazándola con motivo.
 * - **Reserva:** el repuesto que llega a la faena para una OT queda apartado para
 *   ella. Hay UNA reserva activa por (OT, faena, producto); cada aporte o rebaja
 *   queda como fila de origen, que es la trazabilidad NP → solicitud → recepción.
 *   Lo restante y lo libre se calculan (`lib/services/stock-reservations.ts`):
 *   `worksite_stock` no tiene columna de reservado para que no haya dos verdades.
 */

// ── Nota de pedido ──────────────────────────────────────────────────────────

export const mantPartsNotes = pgTable("mant_parts_notes", {
  id:                text("id").primaryKey(),
  /** `NP-AAAA-NNNN` con `nextCodeTx`. */
  code:              text("code").notNull(),
  workOrderId:       text("work_order_id").notNull().references((): AnyPgColumn => mantWorkOrders.id, { onDelete: "restrict" }),
  vehicleId:         text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "restrict" }),
  /** Faena de la OT (no se mueve). Es el alcance de quien la revisa. */
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  requestedByUserId: text("requested_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  deviceId:          text("device_id"),
  /** Idempotencia del envío desde el teléfono: la misma NP llega tres veces y queda una. */
  clientOpId:        text("client_op_id"),
  equipmentStopped:  boolean("equipment_stopped").notNull().default(false),
  notes:             text("notes"),
  /** Derivado de sus líneas: enviada (todas pendientes) → en_gestion → cerrada; o anulada. */
  status:            text("status").notNull().default("enviada"),
  voidedByUserId:    text("voided_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  voidedAt:          timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidReason:        text("void_reason"),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mant_parts_notes_code_unique").on(table.code),
  uniqueIndex("mant_parts_notes_client_op_unique").on(table.clientOpId),
  index("mant_parts_notes_work_order_idx").on(table.workOrderId),
  index("mant_parts_notes_worksite_status_idx").on(table.worksiteId, table.status),
  check("mant_parts_notes_status_valid", sql`${table.status} IN ('enviada', 'en_gestion', 'cerrada', 'anulada')`),
  check("mant_parts_notes_notes_valid", sql`${table.notes} IS NULL OR char_length(${table.notes}) <= 500`),
  check("mant_parts_notes_void_valid", sql`
    (${table.status} = 'anulada' AND ${table.voidedAt} IS NOT NULL AND ${table.voidedByUserId} IS NOT NULL
      AND char_length(trim(coalesce(${table.voidReason}, ''))) >= 5)
    OR (${table.status} <> 'anulada' AND ${table.voidedAt} IS NULL AND ${table.voidedByUserId} IS NULL AND ${table.voidReason} IS NULL)
  `),
])

export const mantPartsNoteItems = pgTable("mant_parts_note_items", {
  id:               text("id").primaryKey(),
  noteId:           text("note_id").notNull().references(() => mantPartsNotes.id, { onDelete: "cascade" }),
  description:      text("description").notNull(),
  quantity:         numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull(),
  unitOfMeasure:    text("unit_of_measure").notNull().default("unidad"),
  partNumber:       text("part_number"),
  /** Producto del catálogo de repuestos, si el mecánico o jefatura lo eligió. */
  productId:        text("product_id").references(() => products.id, { onDelete: "restrict" }),
  resolution:       text("resolution").notNull().default("pendiente"),
  resolutionReason: text("resolution_reason"),
  resolvedByUserId: text("resolved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  resolvedAt:       timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  sortOrder:        integer("sort_order").notNull().default(0),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("mant_parts_note_items_note_idx").on(table.noteId),
  uniqueIndex("mant_parts_note_items_order_unique").on(table.noteId, table.sortOrder),
  check("mant_parts_note_items_description_valid", sql`char_length(trim(${table.description})) BETWEEN 3 AND 300`),
  check("mant_parts_note_items_quantity_positive", sql`${table.quantity} > 0`),
  check("mant_parts_note_items_resolution_valid", sql`${table.resolution} IN ('pendiente', 'desde_stock', 'en_compra', 'rechazada')`),
  check("mant_parts_note_items_rejected_reason", sql`${table.resolution} <> 'rechazada' OR char_length(trim(coalesce(${table.resolutionReason}, ''))) >= 5`),
  check("mant_parts_note_items_from_stock_product", sql`${table.resolution} <> 'desde_stock' OR ${table.productId} IS NOT NULL`),
  check("mant_parts_note_items_resolved_valid", sql`
    (${table.resolution} = 'pendiente' AND ${table.resolvedAt} IS NULL AND ${table.resolvedByUserId} IS NULL)
    OR (${table.resolution} <> 'pendiente' AND ${table.resolvedAt} IS NOT NULL AND ${table.resolvedByUserId} IS NOT NULL)
  `),
])

// ── Reserva por OT ──────────────────────────────────────────────────────────

export const mantPartsAllocations = pgTable("mant_parts_allocations", {
  id:               text("id").primaryKey(),
  workOrderId:      text("work_order_id").notNull().references((): AnyPgColumn => mantWorkOrders.id, { onDelete: "restrict" }),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  productId:        text("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  /** Suma de los orígenes. Restante = activa ? max(0, quantity − consumido) : 0. */
  quantity:         numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
  status:           text("status").notNull().default("activa"),
  /** Sólo auditoría: lo que quedaba sin usar al liberarse con la OT cerrada o anulada. */
  releasedQuantity: numeric("released_quantity", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
  releasedByUserId: text("released_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  releasedAt:       timestamp("released_at", { withTimezone: true, mode: "string" }),
  releaseReason:    text("release_reason"),
  createdByUserId:  text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mant_parts_allocations_active_unique")
    .on(table.workOrderId, table.worksiteId, table.productId)
    .where(sql`${table.status} = 'activa'`),
  index("mant_parts_allocations_stock_idx").on(table.worksiteId, table.productId).where(sql`${table.status} = 'activa'`),
  index("mant_parts_allocations_work_order_idx").on(table.workOrderId),
  check("mant_parts_allocations_quantity_valid", sql`${table.quantity} >= 0 AND ${table.releasedQuantity} >= 0`),
  check("mant_parts_allocations_status_valid", sql`${table.status} IN ('activa', 'liberada')`),
  check("mant_parts_allocations_release_valid", sql`
    (${table.status} = 'activa' AND ${table.releasedAt} IS NULL AND ${table.releasedByUserId} IS NULL AND ${table.releaseReason} IS NULL AND ${table.releasedQuantity} = 0)
    OR (${table.status} = 'liberada' AND ${table.releasedAt} IS NOT NULL AND ${table.releasedByUserId} IS NOT NULL
      AND char_length(trim(coalesce(${table.releaseReason}, ''))) >= 3)
  `),
])

/**
 * Cada aporte (+) o rebaja (−) de una reserva. Aportes: recepción en faena,
 * stock existente (jefatura resolvió una línea de NP «desde stock») y traslado
 * (guía oficina → faena). Rebajas: anulación de recepción o guía, diferencia del
 * cotejo, ajuste de inventario y liberación manual.
 */
export const mantPartsAllocationSources = pgTable("mant_parts_allocation_sources", {
  id:              text("id").primaryKey(),
  allocationId:    text("allocation_id").notNull(),
  source:          text("source").notNull(),
  quantity:        numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull(),
  noteItemId:      text("note_item_id"),
  requestItemId:   text("request_item_id"),
  receiptId:       text("receipt_id").references((): AnyPgColumn => receipts.id, { onDelete: "set null" }),
  dispatchGuideId: text("dispatch_guide_id"),
  actorUserId:     text("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  reason:          text("reason"),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Nombres explícitos: los autogenerados pasan de 63 bytes y Postgres los truncaría.
  foreignKey({ columns: [table.allocationId], foreignColumns: [mantPartsAllocations.id], name: "mant_parts_alloc_sources_allocation_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.noteItemId], foreignColumns: [mantPartsNoteItems.id], name: "mant_parts_alloc_sources_note_item_fk" }).onDelete("set null"),
  foreignKey({ columns: [table.requestItemId], foreignColumns: [purchaseRequestItems.id], name: "mant_parts_alloc_sources_request_item_fk" }).onDelete("set null"),
  foreignKey({ columns: [table.dispatchGuideId], foreignColumns: [dispatchGuides.id], name: "mant_parts_alloc_sources_guide_fk" }).onDelete("set null"),
  index("mant_parts_allocation_sources_allocation_idx").on(table.allocationId, table.createdAt),
  index("mant_parts_allocation_sources_receipt_idx").on(table.receiptId),
  index("mant_parts_allocation_sources_guide_idx").on(table.dispatchGuideId),
  index("mant_parts_allocation_sources_note_item_idx").on(table.noteItemId),
  check("mant_parts_allocation_sources_source_valid", sql`
    (${table.source} IN ('recepcion', 'stock_existente', 'traslado') AND ${table.quantity} > 0)
    OR (${table.source} IN ('anulacion_recepcion', 'anulacion_guia', 'cotejo', 'ajuste', 'liberacion') AND ${table.quantity} < 0)
  `),
])

// ── Relaciones ──────────────────────────────────────────────────────────────

export const mantPartsNotesRelations = relations(mantPartsNotes, ({ one, many }) => ({
  workOrder:   one(mantWorkOrders, { fields: [mantPartsNotes.workOrderId], references: [mantWorkOrders.id] }),
  vehicle:     one(fuelVehicles, { fields: [mantPartsNotes.vehicleId], references: [fuelVehicles.id] }),
  worksite:    one(worksites, { fields: [mantPartsNotes.worksiteId], references: [worksites.id] }),
  requestedBy: one(users, { fields: [mantPartsNotes.requestedByUserId], references: [users.id], relationName: "mant_parts_note_requested_by" }),
  items:       many(mantPartsNoteItems),
}))

export const mantPartsNoteItemsRelations = relations(mantPartsNoteItems, ({ one }) => ({
  note:    one(mantPartsNotes, { fields: [mantPartsNoteItems.noteId], references: [mantPartsNotes.id] }),
  product: one(products, { fields: [mantPartsNoteItems.productId], references: [products.id] }),
}))

export const mantPartsAllocationsRelations = relations(mantPartsAllocations, ({ one, many }) => ({
  workOrder: one(mantWorkOrders, { fields: [mantPartsAllocations.workOrderId], references: [mantWorkOrders.id] }),
  worksite:  one(worksites, { fields: [mantPartsAllocations.worksiteId], references: [worksites.id] }),
  product:   one(products, { fields: [mantPartsAllocations.productId], references: [products.id] }),
  sources:   many(mantPartsAllocationSources),
}))

export const mantPartsAllocationSourcesRelations = relations(mantPartsAllocationSources, ({ one }) => ({
  allocation: one(mantPartsAllocations, { fields: [mantPartsAllocationSources.allocationId], references: [mantPartsAllocations.id] }),
}))

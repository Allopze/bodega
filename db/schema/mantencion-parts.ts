import { relations, sql } from "drizzle-orm"
import { bigint, boolean, check, foreignKey, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core"
import { fuelVehicles } from "./fuel-vehicles"
import { users } from "./users"
import { worksites, suppliers } from "./worksites"
import { products } from "./products"
import { costCenters } from "./cost-centers"
import { mantWorkOrders } from "./mantencion-work-orders"
import { purchaseRequestItems } from "./requests"
import { receipts } from "./receiving"
import { dispatchGuides } from "./dispatch-guides"

/**
 * Repuestos de mantención con stock (ADR `docs/mantencion/adr/0001-…`, 2026-11-26).
 *
 * - **Nota de pedido (NP):** pide repuestos. Con OT (el mecánico, desde el teléfono) o SIN OT (pedido de taller, reposición,
 *   importado de otro sistema, con centro de cargo). Jefatura resuelve cada línea: desde el stock de la faena (sólo con OT),
 *   comprando (la solicitud de compra apunta a la línea con `purchase_request_items.parts_note_item_id`) o rechazándola con motivo.
 * - **Estado de la NP:** lo fija `setNoteStatusTx` (lib/services/mantencion/parts-notes/set-status.ts) y deja un evento en
 *   `mant_parts_note_events` en el mismo paso. `mant_parts_note_events` es append-only (trigger en la migración 0405).
 * - **Reserva:** el repuesto que llega a la faena para una OT queda apartado para ella. Hay UNA reserva activa por (OT, faena, producto);
 *   cada aporte o rebaja queda como fila de origen, que es la trazabilidad NP → solicitud → recepción.
 *   Lo restante y lo libre se calculan (`lib/services/stock-reservations.ts`): `worksite_stock` no tiene columna de reservado.
 */

// ── Nota de pedido ──────────────────────────────────────────────────────────

const PARTS_NOTE_STATUSES = [
  "enviada", "aceptada", "en_espera", "en_gestion", "en_compra", "recibida_parcial", "cerrada", "rechazada", "anulada",
] as const

const PARTS_NOTE_STATUS_SQL = sql.raw(PARTS_NOTE_STATUSES.map((status) => `'${status}'`).join(", "))

export const mantPartsNotes = pgTable("mant_parts_notes", {
  id:                text("id").primaryKey(),
  /** `NP-AAAA-NNNN` con `nextCodeTx`, o el folio de la importación. */
  code:              text("code").notNull(),
  /** Null: nota sin OT (pedido de taller, reposición). Con OT, la OT es la de la NP y no cambia. */
  workOrderId:       text("work_order_id").references((): AnyPgColumn => mantWorkOrders.id, { onDelete: "restrict" }),
  /** Equipo de la OT. Sin OT puede no haberlo (la NP se hace para la faena). */
  vehicleId:         text("vehicle_id").references(() => fuelVehicles.id, { onDelete: "restrict" }),
  /** Faena de la NP. Con OT es la de la OT (no se mueve) y es el alcance de quien la revisa. */
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  /** Null sólo en notas importadas (sin usuario de CHOME): entonces van `requested_by_name` y `external_ref`. */
  requestedByUserId: text("requested_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  requestedByName:   text("requested_by_name"),
  deviceId:          text("device_id"),
  /** Idempotencia del envío desde el teléfono y del alta web: la misma NP llega tres veces y queda una. */
  clientOpId:        text("client_op_id"),
  /** Folio del sistema de origen (p. ej. `CHOME-123`) cuando la NP se importó. Único. */
  externalRef:       text("external_ref"),
  /** «El equipo está detenido»: lo que manda el teléfono. Se conserva tal cual. */
  equipmentStopped:  boolean("equipment_stopped").notNull().default(false),
  /** Urgencia que fija quien crea la NP (sin OT también); backfill: `urgent = equipment_stopped`. */
  urgent:            boolean("urgent").notNull().default(false),
  notes:             text("notes"),
  /** Estado de la cabecera. Sólo `setNoteStatusTx` lo escribe; el último evento siempre dice lo mismo. */
  status:            text("status").notNull().default("enviada"),
  /** Motivo de «En espera»: exigido por CHECK cuando el estado es `en_espera`, y nulo en cualquier otro. */
  holdReason:        text("hold_reason"),
  voidedByUserId:    text("voided_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  voidedAt:          timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidReason:        text("void_reason"),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mant_parts_notes_code_unique").on(table.code),
  uniqueIndex("mant_parts_notes_client_op_unique").on(table.clientOpId),
  uniqueIndex("mant_parts_notes_external_ref_unique").on(table.externalRef),
  index("mant_parts_notes_work_order_idx").on(table.workOrderId),
  index("mant_parts_notes_worksite_status_idx").on(table.worksiteId, table.status),
  check("mant_parts_notes_status_valid", sql`${table.status} IN (${PARTS_NOTE_STATUS_SQL})`),
  check("mant_parts_notes_notes_valid", sql`${table.notes} IS NULL OR char_length(${table.notes}) <= 500`),
  // Con OT hay equipo: una OT sin equipo no existe, y una NP sin OT puede no tener equipo.
  check("mant_parts_notes_work_order_vehicle", sql`${table.vehicleId} IS NOT NULL OR ${table.workOrderId} IS NULL`),
  // Quién la pidió: un usuario de CHOME, o (sólo importadas) el folio de origen.
  check("mant_parts_notes_requester_valid", sql`${table.requestedByUserId} IS NOT NULL OR ${table.externalRef} IS NOT NULL`),
  check("mant_parts_notes_hold_valid", sql`
    (${table.status} = 'en_espera' AND char_length(trim(coalesce(${table.holdReason}, ''))) >= 5)
    OR (${table.status} <> 'en_espera' AND ${table.holdReason} IS NULL)
  `),
  check("mant_parts_notes_void_valid", sql`
    (${table.status} = 'anulada' AND ${table.voidedAt} IS NOT NULL AND ${table.voidedByUserId} IS NOT NULL
      AND char_length(trim(coalesce(${table.voidReason}, ''))) >= 5)
    OR (${table.status} <> 'anulada' AND ${table.voidedAt} IS NULL AND ${table.voidedByUserId} IS NULL AND ${table.voidReason} IS NULL)
  `),
])

export const mantPartsNoteItems = pgTable("mant_parts_note_items", {
  id:                 text("id").primaryKey(),
  noteId:             text("note_id").notNull().references(() => mantPartsNotes.id, { onDelete: "cascade" }),
  description:        text("description").notNull(),
  quantity:           numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull(),
  unitOfMeasure:      text("unit_of_measure").notNull().default("unidad"),
  partNumber:         text("part_number"),
  /** Producto del catálogo de repuestos, si el mecánico o jefatura lo eligió. */
  productId:          text("product_id").references(() => products.id, { onDelete: "restrict" }),
  /** Equipo al que se imputa la línea (cargo). Excluyente con `charge_cost_center_id`. */
  chargeVehicleId:    text("charge_vehicle_id").references(() => fuelVehicles.id, { onDelete: "restrict" }),
  /** Centro de costo al que se imputa la línea («Taller»…). Excluyente con `charge_vehicle_id`. */
  chargeCostCenterId: text("charge_cost_center_id").references(() => costCenters.id, { onDelete: "restrict" }),
  /** Cargo original tal como llegó, sin calce (p. ej. «CR43-51-52» de una importación). */
  chargeText:         text("charge_text"),
  /** Proveedor sugerido del catálogo, y/o el texto libre. */
  suggestedSupplierId: text("suggested_supplier_id").references(() => suppliers.id, { onDelete: "restrict" }),
  supplierHint:       text("supplier_hint"),
  resolution:         text("resolution").notNull().default("pendiente"),
  resolutionReason:   text("resolution_reason"),
  resolvedByUserId:   text("resolved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  resolvedAt:         timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  sortOrder:          integer("sort_order").notNull().default(0),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("mant_parts_note_items_note_idx").on(table.noteId),
  uniqueIndex("mant_parts_note_items_order_unique").on(table.noteId, table.sortOrder),
  index("mant_parts_note_items_charge_vehicle_idx").on(table.chargeVehicleId),
  check("mant_parts_note_items_description_valid", sql`char_length(trim(${table.description})) BETWEEN 1 AND 300`),
  check("mant_parts_note_items_quantity_positive", sql`${table.quantity} > 0`),
  check("mant_parts_note_items_charge_one", sql`NOT (${table.chargeVehicleId} IS NOT NULL AND ${table.chargeCostCenterId} IS NOT NULL)`),
  check("mant_parts_note_items_resolution_valid", sql`${table.resolution} IN ('pendiente', 'desde_stock', 'en_compra', 'rechazada')`),
  check("mant_parts_note_items_rejected_reason", sql`${table.resolution} <> 'rechazada' OR char_length(trim(coalesce(${table.resolutionReason}, ''))) >= 5`),
  check("mant_parts_note_items_from_stock_product", sql`${table.resolution} <> 'desde_stock' OR ${table.productId} IS NOT NULL`),
  check("mant_parts_note_items_resolved_valid", sql`
    (${table.resolution} = 'pendiente' AND ${table.resolvedAt} IS NULL AND ${table.resolvedByUserId} IS NULL)
    OR (${table.resolution} <> 'pendiente' AND ${table.resolvedAt} IS NOT NULL AND ${table.resolvedByUserId} IS NOT NULL)
  `),
])

/**
 * Historial de la nota: cada alta, cada cambio de estado y cada importación. APPEND-ONLY: un trigger (migración 0405) rechaza
 * UPDATE y DELETE. Invariante: `mant_parts_notes.status` = `to_status` del último evento de la nota (el de mayor `seq`).
 * `created_at` puede repetirse dentro de una misma transacción: el orden real es `seq`.
 */
export const mantPartsNoteEvents = pgTable("mant_parts_note_events", {
  id:          text("id").primaryKey(),
  seq:         bigint("seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
  noteId:      text("note_id").notNull().references(() => mantPartsNotes.id, { onDelete: "restrict" }),
  kind:        text("kind").notNull(),
  fromStatus:  text("from_status"),
  toStatus:    text("to_status").notNull(),
  reason:      text("reason"),
  /** Null = automático del sistema (una llegada, una recepción, la OT que termina). */
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
  /** Línea que causó el cambio, si lo hubo. */
  itemId:      text("item_id").references(() => mantPartsNoteItems.id, { onDelete: "restrict" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("mant_parts_note_events_note_idx").on(table.noteId, table.createdAt),
  index("mant_parts_note_events_note_seq_idx").on(table.noteId, table.seq),
  check("mant_parts_note_events_kind_valid", sql`${table.kind} IN ('creada', 'transicion', 'migrada')`),
  check("mant_parts_note_events_to_status_valid", sql`${table.toStatus} IN (${PARTS_NOTE_STATUS_SQL})`),
  check("mant_parts_note_events_from_status_valid", sql`
    (${table.kind} IN ('creada', 'migrada') AND ${table.fromStatus} IS NULL)
    OR (${table.kind} = 'transicion' AND ${table.fromStatus} IS NOT NULL AND ${table.fromStatus} IN (${PARTS_NOTE_STATUS_SQL}))
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
  events:      many(mantPartsNoteEvents),
}))

export const mantPartsNoteItemsRelations = relations(mantPartsNoteItems, ({ one }) => ({
  note:              one(mantPartsNotes, { fields: [mantPartsNoteItems.noteId], references: [mantPartsNotes.id] }),
  product:           one(products, { fields: [mantPartsNoteItems.productId], references: [products.id] }),
  chargeVehicle:     one(fuelVehicles, { fields: [mantPartsNoteItems.chargeVehicleId], references: [fuelVehicles.id] }),
  chargeCostCenter:  one(costCenters, { fields: [mantPartsNoteItems.chargeCostCenterId], references: [costCenters.id] }),
  suggestedSupplier: one(suppliers, { fields: [mantPartsNoteItems.suggestedSupplierId], references: [suppliers.id] }),
}))

export const mantPartsNoteEventsRelations = relations(mantPartsNoteEvents, ({ one }) => ({
  note: one(mantPartsNotes, { fields: [mantPartsNoteEvents.noteId], references: [mantPartsNotes.id] }),
  item: one(mantPartsNoteItems, { fields: [mantPartsNoteEvents.itemId], references: [mantPartsNoteItems.id] }),
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

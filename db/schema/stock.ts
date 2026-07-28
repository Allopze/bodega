import { sql } from "drizzle-orm"
import { pgTable, text, real, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { users } from "./users"
import { worksites } from "./worksites"
import { products } from "./products"
import { deliveryItems, receiptItems } from "./receiving"

/* ── Worksite Stock (Stock por Faena) ──────────────────────────────────── */
export const worksiteStock = pgTable("worksite_stock", {
  id:               text("id").primaryKey(),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  productId:        text("product_id").notNull().references(() => products.id),
  quantity:         real("quantity").notNull().default(0),
  minStock:         real("min_stock").notNull().default(0),
  lastMovementAt:   text("last_movement_at"),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Invariant: stock quantity and minStock must never be negative
  check("worksite_stock_quantity_non_negative", sql`${table.quantity} >= 0`),
  check("worksite_stock_min_stock_non_negative", sql`${table.minStock} >= 0`),
  uniqueIndex("worksite_stock_unique").on(table.worksiteId, table.productId),
])

/* ── Inventory Movements ────────────────────────────────────────────────── */
export const inventoryMovements = pgTable("inventory_movements", {
  id:             text("id").primaryKey(),
  worksiteId:     text("worksite_id").notNull().references(() => worksites.id),
  productId:      text("product_id").notNull().references(() => products.id),
  type:           text("type").notNull(),
  quantity:       real("quantity").notNull(),
  referenceType:  text("reference_type"),
  referenceId:    text("reference_id"),
  stockBefore:    real("stock_before").notNull().default(0),
  stockAfter:     real("stock_after").notNull().default(0),
  performedBy:    text("performed_by").notNull().references(() => users.id),
  performedAt:    timestamp("performed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  reason:         text("reason"),
  notes:          text("notes"),
}, (table) => [
  // Invariant: movement type from canonical set; stock before/after must be non-negative
  check("inventory_movements_type_valid", sql`
    ${table.type} IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion', 'egreso_desecho', 'retiro_epp_trabajador', 'ajuste')
  `),
  check("inventory_movements_stock_non_negative", sql`
    ${table.stockBefore} >= 0
    AND ${table.stockAfter} >= 0
  `),
  index("inventory_movements_worksite_performed_at_idx").on(table.worksiteId, table.performedAt),
  index("inventory_movements_product_performed_at_idx").on(table.productId, table.performedAt),
  index("idx_inventory_mov_worksite_prod_type").on(table.worksiteId, table.productId, table.type),
])

/* ── Manual stock documents ─────────────────────────────────────────────── */
// Free-text reasons explain a movement but are not a traceable source. These
// headers provide a stable folio for kardex, evidence and future attachments.
export const stockAdjustments = pgTable("stock_adjustments", {
  id:          text("id").primaryKey(),
  code:        text("code").notNull().unique(),
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  productId:   text("product_id").notNull().references(() => products.id),
  quantity:    real("quantity").notNull(),
  reason:      text("reason").notNull(),
  notes:       text("notes"),
  createdBy:   text("created_by").notNull().references(() => users.id),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("stock_adjustments_quantity_nonzero", sql`${table.quantity} <> 0`),
  index("stock_adjustments_worksite_created_at_idx").on(table.worksiteId, table.createdAt),
])

export const stockReturns = pgTable("stock_returns", {
  id:          text("id").primaryKey(),
  code:        text("code").notNull().unique(),
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  productId:   text("product_id").notNull().references(() => products.id),
  // New returns always originate in a specific delivery line. Nullable keeps
  // the migration compatible with any historical, unlinked return documents.
  deliveryItemId: text("delivery_item_id").references(() => deliveryItems.id),
  quantity:    real("quantity").notNull(),
  reason:      text("reason").notNull(),
  notes:       text("notes"),
  createdBy:   text("created_by").notNull().references(() => users.id),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("stock_returns_quantity_positive", sql`${table.quantity} > 0`),
  index("stock_returns_worksite_created_at_idx").on(table.worksiteId, table.createdAt),
  index("stock_returns_delivery_item_idx").on(table.deliveryItemId),
])

export const physicalInventoryCounts = pgTable("physical_inventory_counts", {
  id:          text("id").primaryKey(),
  code:        text("code").notNull().unique(),
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  status:      text("status").notNull().default("draft"),
  countedBy:   text("counted_by").notNull().references(() => users.id),
  closedBy:    text("closed_by").references(() => users.id),
  closedAt:    timestamp("closed_at", { withTimezone: true, mode: "string" }),
  notes:       text("notes"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("physical_inventory_counts_status_valid", sql`${table.status} IN ('draft', 'closed', 'cancelled')`),
  index("physical_inventory_counts_worksite_status_idx").on(table.worksiteId, table.status),
])

export const physicalInventoryCountItems = pgTable("physical_inventory_count_items", {
  id:               text("id").primaryKey(),
  countId:          text("count_id").notNull().references(() => physicalInventoryCounts.id, { onDelete: "cascade" }),
  productId:        text("product_id").notNull().references(() => products.id),
  expectedQuantity: real("expected_quantity").notNull().default(0),
  countedQuantity:  real("counted_quantity").notNull().default(0),
  difference:       real("difference").notNull().default(0),
  notes:            text("notes"),
}, (table) => [
  uniqueIndex("physical_inventory_count_items_unique").on(table.countId, table.productId),
])

/* ── Relations ──────────────────────────────────────────────────────────── */
export const worksiteStockRelations = relations(worksiteStock, ({ one }) => ({
  worksite: one(worksites, { fields: [worksiteStock.worksiteId], references: [worksites.id] }),
  product:  one(products, { fields: [worksiteStock.productId], references: [products.id] }),
}))

/* ── EPP lot traceability ───────────────────────────────────────────────── */
// EPP cannot be treated as interchangeable aggregate stock: every ingress at
// faena records its lot and expiration, and worker deliveries consume lots FEFO.
export const inventoryLots = pgTable("inventory_lots", {
  id:                text("id").primaryKey(),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id),
  productId:         text("product_id").notNull().references(() => products.id),
  receiptItemId:     text("receipt_item_id").notNull().references(() => receiptItems.id),
  lotNumber:         text("lot_number").notNull(),
  manufacturedAt:    text("manufactured_at").notNull(),
  expiresAt:         text("expires_at").notNull(),
  quantityReceived:  real("quantity_received").notNull(),
  quantityAvailable: real("quantity_available").notNull(),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("inventory_lots_quantities_valid", sql`${table.quantityReceived} > 0 AND ${table.quantityAvailable} >= 0 AND ${table.quantityAvailable} <= ${table.quantityReceived}`),
  check("inventory_lots_dates_valid", sql`${table.manufacturedAt} <= ${table.expiresAt}`),
  uniqueIndex("inventory_lots_unique_source").on(table.receiptItemId),
  index("inventory_lots_fefo_idx").on(table.worksiteId, table.productId, table.expiresAt),
])

export const deliveryItemLots = pgTable("delivery_item_lots", {
  id:             text("id").primaryKey(),
  deliveryItemId: text("delivery_item_id").notNull().references(() => deliveryItems.id, { onDelete: "cascade" }),
  inventoryLotId: text("inventory_lot_id").notNull().references(() => inventoryLots.id),
  quantity:       real("quantity").notNull(),
}, (table) => [
  check("delivery_item_lots_quantity_positive", sql`${table.quantity} > 0`),
  uniqueIndex("delivery_item_lots_unique").on(table.deliveryItemId, table.inventoryLotId),
])

export const inventoryLotsRelations = relations(inventoryLots, ({ one, many }) => ({
  worksite: one(worksites, { fields: [inventoryLots.worksiteId], references: [worksites.id] }),
  product: one(products, { fields: [inventoryLots.productId], references: [products.id] }),
  receiptItem: one(receiptItems, { fields: [inventoryLots.receiptItemId], references: [receiptItems.id] }),
  deliveryAllocations: many(deliveryItemLots),
}))

export const deliveryItemLotsRelations = relations(deliveryItemLots, ({ one }) => ({
  deliveryItem: one(deliveryItems, { fields: [deliveryItemLots.deliveryItemId], references: [deliveryItems.id] }),
  inventoryLot: one(inventoryLots, { fields: [deliveryItemLots.inventoryLotId], references: [inventoryLots.id] }),
}))

export const inventoryMovementsRelations = relations(inventoryMovements, ({ one }) => ({
  worksite:    one(worksites, { fields: [inventoryMovements.worksiteId], references: [worksites.id] }),
  product:     one(products, { fields: [inventoryMovements.productId], references: [products.id] }),
  performedBy: one(users, { fields: [inventoryMovements.performedBy], references: [users.id] }),
}))

export const stockAdjustmentsRelations = relations(stockAdjustments, ({ one }) => ({
  worksite: one(worksites, { fields: [stockAdjustments.worksiteId], references: [worksites.id] }),
  product: one(products, { fields: [stockAdjustments.productId], references: [products.id] }),
  createdByUser: one(users, { fields: [stockAdjustments.createdBy], references: [users.id] }),
}))

export const stockReturnsRelations = relations(stockReturns, ({ one }) => ({
  worksite: one(worksites, { fields: [stockReturns.worksiteId], references: [worksites.id] }),
  product: one(products, { fields: [stockReturns.productId], references: [products.id] }),
  deliveryItem: one(deliveryItems, { fields: [stockReturns.deliveryItemId], references: [deliveryItems.id] }),
  createdByUser: one(users, { fields: [stockReturns.createdBy], references: [users.id] }),
}))

export const physicalInventoryCountsRelations = relations(physicalInventoryCounts, ({ one, many }) => ({
  worksite: one(worksites, { fields: [physicalInventoryCounts.worksiteId], references: [worksites.id] }),
  countedByUser: one(users, { fields: [physicalInventoryCounts.countedBy], references: [users.id] }),
  closedByUser: one(users, { fields: [physicalInventoryCounts.closedBy], references: [users.id] }),
  items: many(physicalInventoryCountItems),
}))

export const physicalInventoryCountItemsRelations = relations(physicalInventoryCountItems, ({ one }) => ({
  count: one(physicalInventoryCounts, {
    fields: [physicalInventoryCountItems.countId],
    references: [physicalInventoryCounts.id],
  }),
  product: one(products, {
    fields: [physicalInventoryCountItems.productId],
    references: [products.id],
  }),
}))

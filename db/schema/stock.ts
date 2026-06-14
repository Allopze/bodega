import { sql } from "drizzle-orm"
import { pgTable, text, real, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { users } from "./users"
import { worksites } from "./worksites"
import { products } from "./products"

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
  check("inventory_movements_type_valid", sql`
    ${table.type} IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion')
  `),
  check("inventory_movements_stock_non_negative", sql`
    ${table.stockBefore} >= 0
    AND ${table.stockAfter} >= 0
  `),
  index("inventory_movements_worksite_performed_at_idx").on(table.worksiteId, table.performedAt),
  index("inventory_movements_product_performed_at_idx").on(table.productId, table.performedAt),
])

/* ── Relations ──────────────────────────────────────────────────────────── */
export const worksiteStockRelations = relations(worksiteStock, ({ one }) => ({
  worksite: one(worksites, { fields: [worksiteStock.worksiteId], references: [worksites.id] }),
  product:  one(products, { fields: [worksiteStock.productId], references: [products.id] }),
}))

export const inventoryMovementsRelations = relations(inventoryMovements, ({ one }) => ({
  worksite:    one(worksites, { fields: [inventoryMovements.worksiteId], references: [worksites.id] }),
  product:     one(products, { fields: [inventoryMovements.productId], references: [products.id] }),
  performedBy: one(users, { fields: [inventoryMovements.performedBy], references: [users.id] }),
}))

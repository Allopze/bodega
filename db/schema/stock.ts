import { sqliteTable, text, real, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"
import { users } from "./users"
import { worksites } from "./worksites"
import { products } from "./products"

/* ── Worksite Stock (Stock por Faena) ──────────────────────────────────── */
export const worksiteStock = sqliteTable("worksite_stock", {
  id:               text("id").primaryKey(),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  productId:        text("product_id").notNull().references(() => products.id),
  quantity:         real("quantity").notNull().default(0),
  minStock:         real("min_stock").notNull().default(0),
  lastMovementAt:   text("last_movement_at"),
  updatedAt:        text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("worksite_stock_unique").on(table.worksiteId, table.productId),
])

/* ── Inventory Movements ────────────────────────────────────────────────── */
export const inventoryMovements = sqliteTable("inventory_movements", {
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
  performedAt:    text("performed_at").notNull().default(sql`(datetime('now'))`),
  reason:         text("reason"),
  notes:          text("notes"),
}, (table) => [
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

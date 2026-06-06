import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"
import { users } from "./users"
import { worksites } from "./worksites"
import { products } from "./products"

/* ── Warehouses (Bodegas) ─────────────────────────────────────────────────── */
export const warehouses = sqliteTable("warehouses", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull(),
  code:        text("code").notNull().unique(),
  type:        text("type").notNull().default("central"),  // central | worksite | transit
  worksiteId:  text("worksite_id").references(() => worksites.id),
  address:     text("address"),
  isActive:    integer("is_active", { mode: "boolean" }).notNull().default(true),
  notes:       text("notes"),
  createdAt:   text("created_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Warehouse Stock ─────────────────────────────────────────────────────── */
export const warehouseStock = sqliteTable("warehouse_stock", {
  id:               text("id").primaryKey(),
  warehouseId:      text("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "cascade" }),
  productId:        text("product_id").notNull().references(() => products.id),
  quantity:         real("quantity").notNull().default(0),
  reservedQty:      real("reserved_qty").notNull().default(0),
  minStock:         real("min_stock").notNull().default(0),
  lastMovementAt:   text("last_movement_at"),
  updatedAt:        text("updated_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Inventory Movements (Movimientos de Inventario) ────────────────────── */
// type: ingreso_oc | egreso_faena | entrega_trabajador | transferencia
//       devolucion | ajuste_positivo | ajuste_negativo | rechazo | merma | anulacion
export const inventoryMovements = sqliteTable("inventory_movements", {
  id:             text("id").primaryKey(),
  warehouseId:    text("warehouse_id").notNull().references(() => warehouses.id),
  productId:      text("product_id").notNull().references(() => products.id),
  type:           text("type").notNull(),
  quantity:       real("quantity").notNull(),       // positive = in, negative = out
  referenceType:  text("reference_type"),           // 'purchase_order' | 'delivery' | 'adjustment' | etc.
  referenceId:    text("reference_id"),
  stockBefore:    real("stock_before").notNull().default(0),
  stockAfter:     real("stock_after").notNull().default(0),
  performedBy:    text("performed_by").notNull().references(() => users.id),
  performedAt:    text("performed_at").notNull().default(sql`(datetime('now'))`),
  reason:         text("reason"),
  notes:          text("notes"),
})

/* ── Relations ───────────────────────────────────────────────────────────── */
export const warehousesRelations = relations(warehouses, ({ one, many }) => ({
  worksite:           one(worksites, { fields: [warehouses.worksiteId], references: [worksites.id] }),
  stock:              many(warehouseStock),
  inventoryMovements: many(inventoryMovements),
}))

export const warehouseStockRelations = relations(warehouseStock, ({ one }) => ({
  warehouse: one(warehouses, { fields: [warehouseStock.warehouseId], references: [warehouses.id] }),
  product:   one(products, { fields: [warehouseStock.productId], references: [products.id] }),
}))

export const inventoryMovementsRelations = relations(inventoryMovements, ({ one }) => ({
  warehouse:   one(warehouses, { fields: [inventoryMovements.warehouseId], references: [warehouses.id] }),
  product:     one(products, { fields: [inventoryMovements.productId], references: [products.id] }),
  performedBy: one(users, { fields: [inventoryMovements.performedBy], references: [users.id] }),
}))

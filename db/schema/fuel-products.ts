import { relations, sql } from "drizzle-orm"
import { boolean, check, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { fuelVehicles } from "./fuel-vehicles"

/** Productos controlados por el dominio de combustibles. */
export const fuelProducts = pgTable("fuel_products", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default("other"),
  unit: text("unit").notNull().default("liter"),
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("fuel_products_code_unique").on(table.code),
  index("fuel_products_active_name_idx").on(table.isActive, table.name),
  check("fuel_products_category_valid", sql`${table.category} IN ('diesel', 'additive', 'gasoline', 'other')`),
  check("fuel_products_unit_valid", sql`${table.unit} IN ('liter', 'kilogram', 'unit')`),
])

/** Compatibilidad explícita entre equipo y producto combustible. */
export const fuelVehicleProducts = pgTable("fuel_vehicle_products", {
  vehicleId: text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => fuelProducts.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.vehicleId, table.productId] }),
  index("fuel_vehicle_products_product_idx").on(table.productId),
])

export const fuelProductsRelations = relations(fuelProducts, ({ many }) => ({
  vehicleLinks: many(fuelVehicleProducts),
}))

export const fuelVehicleProductsRelations = relations(fuelVehicleProducts, ({ one }) => ({
  vehicle: one(fuelVehicles, { fields: [fuelVehicleProducts.vehicleId], references: [fuelVehicles.id] }),
  product: one(fuelProducts, { fields: [fuelVehicleProducts.productId], references: [fuelProducts.id] }),
}))

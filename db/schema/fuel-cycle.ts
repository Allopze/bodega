import { relations, sql } from "drizzle-orm"
import { boolean, check, index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { fuelProducts } from "./fuel-products"
import { fuelSuppliers } from "./fuel-suppliers"
import { fuelVehicles } from "./fuel-vehicles"
import { worksites } from "./worksites"
import { users } from "./users"

/** Estanque físico o punto intermedio que puede recibir y entregar combustible. */
export const fuelStorageLocations = pgTable("fuel_storage_locations", {
  id: text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id),
  productId: text("product_id").notNull().references(() => fuelProducts.id),
  name: text("name").notNull(),
  capacityLiters: numeric("capacity_liters", { precision: 14, scale: 2, mode: "number" }),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("fuel_storage_locations_worksite_name_unique").on(t.worksiteId, t.name),
  index("fuel_storage_locations_worksite_product_idx").on(t.worksiteId, t.productId),
  check("fuel_storage_locations_capacity_positive", sql`${t.capacityLiters} IS NULL OR ${t.capacityLiters} > 0`),
])

/** Evento canónico del ciclo: recepción, transferencia o entrega. */
export const fuelCycleMovements = pgTable("fuel_cycle_movements", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id),
  productId: text("product_id").notNull().references(() => fuelProducts.id),
  quantity: numeric("quantity", { precision: 14, scale: 4, mode: "number" }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  supplierId: text("supplier_id").references(() => fuelSuppliers.id),
  sourceLocationId: text("source_location_id").references(() => fuelStorageLocations.id),
  targetLocationId: text("target_location_id").references(() => fuelStorageLocations.id),
  vehicleId: text("vehicle_id").references(() => fuelVehicles.id),
  documentNumber: text("document_number"),
  sourceType: text("source_type"),
  sourceId: text("source_id"),
  notes: text("notes"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [
  check("fuel_cycle_movements_event_valid", sql`${t.eventType} IN ('received', 'transfer', 'tank_delivery', 'direct_delivery')`),
  check("fuel_cycle_movements_quantity_positive", sql`${t.quantity} > 0`),
  check("fuel_cycle_movements_shape_valid", sql`
    (${t.eventType} = 'received' AND ${t.targetLocationId} IS NOT NULL AND ${t.supplierId} IS NOT NULL)
    OR (${t.eventType} = 'transfer' AND ${t.sourceLocationId} IS NOT NULL AND ${t.targetLocationId} IS NOT NULL AND ${t.sourceLocationId} <> ${t.targetLocationId})
    OR (${t.eventType} = 'tank_delivery' AND ${t.sourceLocationId} IS NOT NULL AND ${t.vehicleId} IS NOT NULL)
    OR (${t.eventType} = 'direct_delivery' AND ${t.vehicleId} IS NOT NULL AND ${t.supplierId} IS NOT NULL)
  `),
  index("fuel_cycle_movements_worksite_time_idx").on(t.worksiteId, t.occurredAt),
  index("fuel_cycle_movements_product_time_idx").on(t.productId, t.occurredAt),
  index("fuel_cycle_movements_vehicle_time_idx").on(t.vehicleId, t.occurredAt),
  index("fuel_cycle_movements_source_idx").on(t.sourceType, t.sourceId),
])

export const fuelStorageLocationsRelations = relations(fuelStorageLocations, ({ one, many }) => ({
  worksite: one(worksites, { fields: [fuelStorageLocations.worksiteId], references: [worksites.id] }),
  product: one(fuelProducts, { fields: [fuelStorageLocations.productId], references: [fuelProducts.id] }),
  sourceMovements: many(fuelCycleMovements, { relationName: "fuel_cycle_source_location" }),
  targetMovements: many(fuelCycleMovements, { relationName: "fuel_cycle_target_location" }),
}))

export const fuelCycleMovementsRelations = relations(fuelCycleMovements, ({ one }) => ({
  worksite: one(worksites, { fields: [fuelCycleMovements.worksiteId], references: [worksites.id] }),
  product: one(fuelProducts, { fields: [fuelCycleMovements.productId], references: [fuelProducts.id] }),
  supplier: one(fuelSuppliers, { fields: [fuelCycleMovements.supplierId], references: [fuelSuppliers.id] }),
  vehicle: one(fuelVehicles, { fields: [fuelCycleMovements.vehicleId], references: [fuelVehicles.id] }),
  sourceLocation: one(fuelStorageLocations, { relationName: "fuel_cycle_source_location", fields: [fuelCycleMovements.sourceLocationId], references: [fuelStorageLocations.id] }),
  targetLocation: one(fuelStorageLocations, { relationName: "fuel_cycle_target_location", fields: [fuelCycleMovements.targetLocationId], references: [fuelStorageLocations.id] }),
  creator: one(users, { fields: [fuelCycleMovements.createdBy], references: [users.id] }),
}))

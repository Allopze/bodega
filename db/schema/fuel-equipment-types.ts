import { sql } from "drizzle-orm"
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

/** Taxonomía configurable para vehículos y maquinaria que consumen combustible. */
export const fuelEquipmentTypes = pgTable("fuel_equipment_types", {
  id:                     text("id").primaryKey(),
  slug:                   text("slug").notNull(),
  name:                   text("name").notNull(),
  category:               text("category").notNull().default("other"),
  defaultMeterType:       text("default_meter_type").notNull().default("none"),
  defaultPerformanceUnit: text("default_performance_unit").notNull().default("not_applicable"),
  description:            text("description"),
  sortOrder:              integer("sort_order").notNull().default(0),
  isSystem:               boolean("is_system").notNull().default(false),
  isActive:               boolean("is_active").notNull().default(true),
  createdAt:              timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:              timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("fuel_equipment_types_slug_unique").on(table.slug),
  index("fuel_equipment_types_category_idx").on(table.category),
  index("fuel_equipment_types_active_sort_idx").on(table.isActive, table.sortOrder),
  check("fuel_equipment_types_category_valid", sql`${table.category} IN ('truck', 'light', 'heavy', 'storage', 'support', 'other')`),
  check("fuel_equipment_types_meter_valid", sql`${table.defaultMeterType} IN ('odometer', 'hour_meter', 'none')`),
  check("fuel_equipment_types_performance_unit_valid", sql`${table.defaultPerformanceUnit} IN ('km_per_liter', 'liters_per_hour', 'not_applicable')`),
])

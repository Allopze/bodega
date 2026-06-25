import { pgTable, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { worksites } from "./worksites"
import { fuelLoads } from "./fuel-invoices"

/* ── Fuel Vehicles (catálogo propio del módulo combustibles) ─────────────── */
export const fuelVehicles = pgTable("fuel_vehicles", {
  id:        text("id").primaryKey(),
  plate:     text("plate").notNull().unique(),       // Patente
  type:      text("type").notNull(),                  // camion | camioneta | estanque
  brand:     text("brand"),                           // Marca
  model:     text("model"),                           // Modelo
  year:      integer("year"),                         // Año
  worksiteId: text("worksite_id").references(() => worksites.id),  // Faena asignada (nullable)
  isActive:  boolean("is_active").notNull().default(true),
  notes:     text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("fuel_vehicles_worksite_idx").on(table.worksiteId),
  index("fuel_vehicles_type_idx").on(table.type),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const fuelVehiclesRelations = relations(fuelVehicles, ({ one, many }) => ({
  worksite: one(worksites, {
    fields: [fuelVehicles.worksiteId],
    references: [worksites.id],
  }),
  loads: many(fuelLoads),
}))

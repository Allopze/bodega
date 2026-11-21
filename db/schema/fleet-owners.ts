import { sql } from "drizzle-orm"
import { boolean, check, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

/**
 * Empresa propietaria de un equipo (2026-11-21, Trinorma): Chome, ASIR,
 * Servimar, un banco o una leasing, o un tercero. Es un dato del equipo, no
 * cambia su faena ni a quién se le imputa el costo (la faena de origen).
 *
 * `kind`: `propia` (Chome), `relacionada` (ASIR, Servimar), `financiera`
 * (banco o leasing) o `tercero`. El catálogo parte vacío: no se inventan
 * empresas, se cargan desde el inventario por script con simulación.
 */
export const fleetOwners = pgTable("fleet_owners", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),
  kind:      text("kind").notNull(),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("fleet_owners_name_unique").on(sql`lower(${table.name})`),
  check("fleet_owners_kind_valid", sql`${table.kind} IN ('propia', 'relacionada', 'financiera', 'tercero')`),
  check("fleet_owners_name_valid", sql`char_length(trim(${table.name})) >= 2`),
])

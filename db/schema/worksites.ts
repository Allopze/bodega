import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"
import { worksiteStock } from "./stock"

/* ── Worksites (Faenas) ─────────────────────────────────────────────────── */
export const worksites = sqliteTable("worksites", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),
  code:      text("code").notNull().unique(),   // e.g. "FN-001"
  address:   text("address"),
  region:    text("region"),
  isActive:  integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Suppliers (Proveedores) ─────────────────────────────────────────────── */
export const suppliers = sqliteTable("suppliers", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull(),
  rut:         text("rut").unique(),            // Chilean RUT
  contactName: text("contact_name"),
  email:       text("email"),
  phone:       text("phone"),
  address:     text("address"),
  paymentTerms: text("payment_terms"),          // "30 días", "contado", etc.
  isActive:    integer("is_active", { mode: "boolean" }).notNull().default(true),
  notes:       text("notes"),
  createdAt:   text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt:   text("updated_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Workers (Trabajadores — for EPP/delivery tracking) ─────────────────── */
export const workers = sqliteTable("workers", {
  id:          text("id").primaryKey(),
  rut:         text("rut").unique(),
  firstName:   text("first_name").notNull(),
  lastName:    text("last_name").notNull(),
  position:    text("position"),               // cargo
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  isActive:    integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt:   text("created_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Relations ───────────────────────────────────────────────────────────── */
export const worksitesRelations = relations(worksites, ({ many }) => ({
  workers: many(workers),
  stock:   many(worksiteStock),
}))

export const workersRelations = relations(workers, ({ one }) => ({
  worksite: one(worksites, { fields: [workers.worksiteId], references: [worksites.id] }),
}))

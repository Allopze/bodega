import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { worksiteStock } from "./stock"

/* ── Worksites (Faenas) ─────────────────────────────────────────────────── */
export const worksites = pgTable("worksites", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),
  code:      text("code").notNull().unique(),   // e.g. "FN-001"
  address:   text("address"),
  region:    text("region"),
  /**
   * Título del cargo `admin_contrato` en el contrato de esta faena:
   * "Administrador de contrato" o "Supervisor de faena" son la misma persona.
   * Null = usar el nombre por defecto (ver `lib/prevention/admin-contrato-label`).
   */
  adminContratoLabel: text("admin_contrato_label"),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("idx_worksites_active").on(table.isActive).where(sql`${table.isActive} = true`),
])

/* ── Suppliers (Proveedores) ─────────────────────────────────────────────── */
export const suppliers = pgTable("suppliers", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull(),
  rut:         text("rut").unique(),            // Chilean RUT
  businessActivity: text("business_activity"),
  contactName: text("contact_name"),
  email:       text("email"),
  phone:       text("phone"),
  address:     text("address"),
  commune:     text("commune"),
  city:        text("city"),
  paymentTerms: text("payment_terms"),          // "30 días", "contado", etc.
  isActive:    boolean("is_active").notNull().default(true),
  notes:       text("notes"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

/* ── Workers (Trabajadores — for EPP/delivery tracking) ─────────────────── */
export const workers = pgTable("workers", {
  id:          text("id").primaryKey(),
  rut:         text("rut").unique(),
  firstName:   text("first_name").notNull(),
  lastName:    text("last_name").notNull(),
  position:       text("position"),               // cargo
  supervisor:     text("supervisor"),              // nombre del supervisor directo
  prevencionista: text("prevencionista"),          // nombre del prevencionista asignado
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  sizeTop:     text("size_top"),
  sizeBottom:  text("size_bottom"),
  sizeShoe:    text("size_shoe"),
  sizeGloves:  text("size_gloves"),
  sizeHelmet:  text("size_helmet"),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

/* ── Relations ───────────────────────────────────────────────────────────── */
export const worksitesRelations = relations(worksites, ({ many }) => ({
  workers: many(workers),
  stock:   many(worksiteStock),
}))

export const workersRelations = relations(workers, ({ one }) => ({
  worksite: one(worksites, { fields: [workers.worksiteId], references: [worksites.id] }),
}))

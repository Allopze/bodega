import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { fuelLoads, fuelMonthlyStatements, fuelPayments } from "./fuel-invoices"
import { suppliers } from "./worksites"

/* ── Fuel Suppliers (catálogo propio del módulo combustibles) ────────────── */
export const fuelSuppliers = pgTable("fuel_suppliers", {
  id:            text("id").primaryKey(),
  supplierId:    text("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  name:          text("name").notNull(),                 // COPEC, ARAMCO
  rut:           text("rut").unique(),                   // RUT proveedor
  contactName:   text("contact_name"),
  contactPhone:  text("phone"),
  contactEmail:  text("email"),
  notes:         text("notes"),
  isActive:      boolean("is_active").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

/* ── Relations ───────────────────────────────────────────────────────────── */
export const fuelSuppliersRelations = relations(fuelSuppliers, ({ one, many }) => ({
  supplier:   one(suppliers, { fields: [fuelSuppliers.supplierId], references: [suppliers.id] }),
  loads:      many(fuelLoads),
  statements: many(fuelMonthlyStatements),
  payments:   many(fuelPayments),
}))

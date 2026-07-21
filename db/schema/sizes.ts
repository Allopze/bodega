import { pgTable, text, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"

/* ── Size Catalog ── Canonical sizes reusable across EPP families ───────── */
export const sizeCatalog = pgTable("size_catalog", {
  id:           text("id").primaryKey(),
  family:       text("family").notNull(),
  code:         text("code").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  isActive:     boolean("is_active").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("size_catalog_family_code_unique").on(table.family, table.code),
])

export const sizeCatalogRelations = relations(sizeCatalog, () => ({}))

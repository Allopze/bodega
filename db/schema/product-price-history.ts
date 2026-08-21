import { index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { products, suppliers, users } from "./index"

export const productSupplierPriceHistory = pgTable("product_supplier_price_history", {
  id:                text("id").primaryKey(),
  productId:         text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  supplierId:        text("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  previousPrice:     numeric("previous_price", { precision: 12, scale: 2, mode: "number" }),
  newPrice:          numeric("new_price", { precision: 12, scale: 2, mode: "number" }),
  source:            text("source").notNull(),
  sourceId:          text("source_id"),
  effectiveDate:     timestamp("effective_date", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdByUserId:   text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("product_supplier_price_history_product_supplier_date_idx").on(table.productId, table.supplierId, table.effectiveDate),
])

export type ProductSupplierPriceHistory = typeof productSupplierPriceHistory.$inferSelect

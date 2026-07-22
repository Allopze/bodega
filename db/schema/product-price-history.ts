import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core"
import { products, suppliers, users } from "./index"

export const productSupplierPriceHistory = pgTable("product_supplier_price_history", {
  id:                text("id").primaryKey(),
  productId:         text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  supplierId:        text("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  unitPrice:         integer("unit_price").notNull(),
  effectiveDate:     timestamp("effective_date", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdByUserId:   text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

export type ProductSupplierPriceHistory = typeof productSupplierPriceHistory.$inferSelect

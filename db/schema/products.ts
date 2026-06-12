import { pgTable, text, integer, boolean, timestamp, numeric, uniqueIndex } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { suppliers } from "./worksites"

/* ── Product Categories ──────────────────────────────────────────────────── */
export const productCategories = pgTable("product_categories", {
  id:                  text("id").primaryKey(),
  name:                text("name").notNull(),
  slug:                text("slug").notNull().unique(),
  isEpp:               boolean("is_epp").notNull().default(false),
  requiresPrevencion:  boolean("requires_prevencion").notNull().default(false),
  sortOrder:           integer("sort_order").notNull().default(0),
})

/* ── Products ────────────────────────────────────────────────────────────── */
export const products = pgTable("products", {
  id:                  text("id").primaryKey(),
  sku:                 text("sku").notNull().unique(),
  name:                text("name").notNull(),
  description:         text("description"),
  categoryId:          text("category_id").notNull().references(() => productCategories.id),
  unitOfMeasure:       text("unit_of_measure").notNull().default("unidad"),
  isEpp:               boolean("is_epp").notNull().default(false),
  requiresPrevencion:  boolean("requires_prevencion").notNull().default(false),
  referencePrice:      numeric("reference_price", { precision: 12, scale: 2, mode: "number" }),
  isActive:            boolean("is_active").notNull().default(true),
  notes:               text("notes"),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

/* ── Product Attributes (talla, color, medida, modelo, etc.) ─────────────── */
export const productAttributes = pgTable("product_attributes", {
  id:            text("id").primaryKey(),
  productId:     text("product_id").references(() => products.id, { onDelete: "cascade" }),
  categoryId:    text("category_id").references(() => productCategories.id, { onDelete: "cascade" }),
  name:          text("name").notNull(),          // "Talla", "Color", "Medida"
  type:          text("type").notNull(),           // "text" | "select" | "number"
  isRequired:    boolean("is_required").notNull().default(false),
  options:       text("options"),                  // JSON array for select type
  sortOrder:     integer("sort_order").notNull().default(0),
})

/* ── Product ↔ Supplier (preferred suppliers + price history) ────────────── */
export const productSuppliers = pgTable("product_suppliers", {
  id:           text("id").primaryKey(),
  productId:    text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  supplierId:   text("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  unitPrice:    numeric("unit_price", { precision: 12, scale: 2, mode: "number" }),
  isPreferred:  boolean("is_preferred").notNull().default(false),
  lastUpdated:  timestamp("last_updated", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  notes:        text("notes"),
}, (table) => [
  uniqueIndex("product_suppliers_product_supplier_unique").on(table.productId, table.supplierId),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const productCategoriesRelations = relations(productCategories, ({ many }) => ({
  products:          many(products),
  productAttributes: many(productAttributes),
}))

export const productsRelations = relations(products, ({ one, many }) => ({
  category:          one(productCategories, { fields: [products.categoryId], references: [productCategories.id] }),
  productAttributes: many(productAttributes),
  productSuppliers:  many(productSuppliers),
}))

export const productAttributesRelations = relations(productAttributes, ({ one }) => ({
  product:  one(products, { fields: [productAttributes.productId], references: [products.id] }),
  category: one(productCategories, { fields: [productAttributes.categoryId], references: [productCategories.id] }),
}))

export const productSuppliersRelations = relations(productSuppliers, ({ one }) => ({
  product:  one(products, { fields: [productSuppliers.productId], references: [products.id] }),
  supplier: one(suppliers, { fields: [productSuppliers.supplierId], references: [suppliers.id] }),
}))

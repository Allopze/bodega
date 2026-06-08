import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"
import { suppliers } from "./worksites"

/* ── Product Categories ──────────────────────────────────────────────────── */
export const productCategories = sqliteTable("product_categories", {
  id:                  text("id").primaryKey(),
  name:                text("name").notNull(),
  slug:                text("slug").notNull().unique(),
  isEpp:               integer("is_epp", { mode: "boolean" }).notNull().default(false),
  requiresPrevencion:  integer("requires_prevencion", { mode: "boolean" }).notNull().default(false),
  sortOrder:           integer("sort_order").notNull().default(0),
})

/* ── Products ────────────────────────────────────────────────────────────── */
export const products = sqliteTable("products", {
  id:                  text("id").primaryKey(),
  sku:                 text("sku").notNull().unique(),
  name:                text("name").notNull(),
  description:         text("description"),
  categoryId:          text("category_id").notNull().references(() => productCategories.id),
  unitOfMeasure:       text("unit_of_measure").notNull().default("unidad"),
  isEpp:               integer("is_epp", { mode: "boolean" }).notNull().default(false),
  requiresPrevencion:  integer("requires_prevencion", { mode: "boolean" }).notNull().default(false),
  referencePrice:      real("reference_price"),
  isActive:            integer("is_active", { mode: "boolean" }).notNull().default(true),
  notes:               text("notes"),
  createdAt:           text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt:           text("updated_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Product Attributes (talla, color, medida, modelo, etc.) ─────────────── */
export const productAttributes = sqliteTable("product_attributes", {
  id:            text("id").primaryKey(),
  productId:     text("product_id").references(() => products.id, { onDelete: "cascade" }),
  categoryId:    text("category_id").references(() => productCategories.id, { onDelete: "cascade" }),
  name:          text("name").notNull(),          // "Talla", "Color", "Medida"
  type:          text("type").notNull(),           // "text" | "select" | "number"
  isRequired:    integer("is_required", { mode: "boolean" }).notNull().default(false),
  options:       text("options"),                  // JSON array for select type
  sortOrder:     integer("sort_order").notNull().default(0),
})

/* ── Product ↔ Supplier (preferred suppliers + price history) ────────────── */
export const productSuppliers = sqliteTable("product_suppliers", {
  id:           text("id").primaryKey(),
  productId:    text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  supplierId:   text("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  unitPrice:    real("unit_price"),
  isPreferred:  integer("is_preferred", { mode: "boolean" }).notNull().default(false),
  lastUpdated:  text("last_updated").notNull().default(sql`(datetime('now'))`),
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

import { pgTable, text, integer, boolean, timestamp, numeric, uniqueIndex } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { suppliers } from "./worksites"
import { eppTypes } from "./epp-types"

/* ── Product Categories ──────────────────────────────────────────────────── */
export const productCategories = pgTable("product_categories", {
  id:                  text("id").primaryKey(),
  name:                text("name").notNull(),
  slug:                text("slug").notNull().unique(),
  isEpp:               boolean("is_epp").notNull().default(false),
  requiresPrevencion:  boolean("requires_prevencion").notNull().default(false),
  sortOrder:           integer("sort_order").notNull().default(0),
})

/* ── EPP product families ────────────────────────────────────────────────── */
export const eppProductFamilies = pgTable("epp_product_families", {
  id:             text("id").primaryKey(),
  categoryId:     text("category_id").notNull().references(() => productCategories.id),
  canonicalName:  text("canonical_name").notNull(),
  identityKey:    text("identity_key").notNull().unique(),
  /** @deprecated Usar eppTypeId (FK canónica a epp_types.id) */
  eppType:        text("epp_type"),
  eppTypeId:      text("epp_type_id").references(() => eppTypes.id),
  brand:          text("brand"),
  model:          text("model"),
  certification:  text("certification"),
  lifespanMonths: integer("lifespan_months"),
  pictogramUrl:   text("pictogram_url"),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

/* ── Products ────────────────────────────────────────────────────────────── */
export const products = pgTable("products", {
  id:                  text("id").primaryKey(),
  sku:                 text("sku").notNull().unique(),
  name:                text("name").notNull(),
  description:         text("description"),
  categoryId:          text("category_id").notNull().references(() => productCategories.id),
  familyId:            text("family_id").references(() => eppProductFamilies.id, { onDelete: "set null" }),
  unitOfMeasure:       text("unit_of_measure").notNull().default("unidad"),
  isEpp:               boolean("is_epp").notNull().default(false),
  requiresPrevencion:  boolean("requires_prevencion").notNull().default(false),
  /**
   * El ítem es un servicio (mantención de monogás, calibración de alcotest,
   * vacunación...): se solicita y se aprueba sin conocer su precio, y el costo
   * real se registra sobre la línea de la OC cuando el proveedor lo factura.
   * No es lo mismo que `requestType = 'servicios'`, que es el flujo por
   * cotización: un servicio de estos convive con EPP en la misma solicitud.
   */
  isService:           boolean("is_service").notNull().default(false),
  /**
   * El ítem se solicita para una persona concreta (vacunas, exámenes). Obliga a
   * `purchase_request_items.worker_id`, la misma FK que ya usa el EPP nominado
   * — no se guarda el nombre suelto.
   */
  requiresWorker:      boolean("requires_worker").notNull().default(false),
  /**
   * Slug de la familia de equipos que este servicio atiende ('monogas',
   * 'alcotest'). Cuando está presente, el ítem debe apuntar a un equipo del
   * registro (`service_equipment`) en vez de re-escribir su código a mano.
   */
  equipmentKind:       text("equipment_kind"),
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
  // "text" | "select" | "number" | "integer".
  // `integer` es un conteo entero ≥ 1 (nº de dosis, de sesiones): se valida así
  // en el formulario y otra vez en el servidor. `number` admite decimales.
  type:          text("type").notNull(),
  isRequired:    boolean("is_required").notNull().default(false),
  options:       text("options"),                  // JSON array for select type
  sizeFamily:    text("size_family"),              // canonical family: 'ropa' | 'calzado' | 'guantes' | 'casco'
  /**
   * El valor de este atributo **es** la cantidad del ítem.
   *
   * Existe porque el "Número de dosis" de una vacuna y la cantidad a comprar son
   * el mismo número: como campos independientes podían contradecirse y la OC
   * terminaba pidiendo 1 unidad de una vacuna de 3 dosis. Sólo tiene sentido en
   * atributos `integer`, y a lo sumo uno por producto.
   */
  drivesQuantity: boolean("drives_quantity").notNull().default(false),
  sortOrder:     integer("sort_order").notNull().default(0),
}, (table) => [
  uniqueIndex("product_attributes_one_quantity_driver")
    .on(table.productId)
    .where(sql`${table.drivesQuantity} = true`),
])

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
  uniqueIndex("product_suppliers_one_preferred_per_product").on(table.productId).where(sql`${table.isPreferred} = true`),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const productCategoriesRelations = relations(productCategories, ({ many }) => ({
  products:          many(products),
  productAttributes: many(productAttributes),
}))

export const eppProductFamiliesRelations = relations(eppProductFamilies, ({ one, many }) => ({
  category: one(productCategories, { fields: [eppProductFamilies.categoryId], references: [productCategories.id] }),
  type:     one(eppTypes, { fields: [eppProductFamilies.eppTypeId], references: [eppTypes.id] }),
  products: many(products),
}))

export const productsRelations = relations(products, ({ one, many }) => ({
  category:          one(productCategories, { fields: [products.categoryId], references: [productCategories.id] }),
  family:            one(eppProductFamilies, { fields: [products.familyId], references: [eppProductFamilies.id] }),
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

/* ── Admin: product unit catalog ──────────────────────────────────────────── */
// Plain-text catalog of units of measure (e.g. "unidad", "kg", "litro"). Used
// to normalize the `products.unitOfMeasure` field that remains a text column
// for backwards compatibility. Existing products retain their legacy value.
export const productUnits = pgTable("product_units", {
  id:          text("id").primaryKey(),
  code:        text("code").notNull().unique(),
  label:       text("label").notNull(),
  description: text("description"),
  sortOrder:   integer("sort_order").notNull().default(0),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

export const productUnitsRelations = relations(productUnits, ({ many }) => ({
  attributeTemplates: many(productAttributeTemplates),
}))

/* ── Admin: reusable attribute templates ─────────────────────────────────── */
// Templates attached to a product category. Reusable across all products that
// belong to that category.
export const productAttributeTemplates = pgTable("product_attribute_templates", {
  id:          text("id").primaryKey(),
  categoryId:  text("category_id").references(() => productCategories.id, { onDelete: "cascade" }),
  name:        text("name").notNull(),
  type:        text("type").notNull(),                                                    // "text" | "select" | "number"
  options:     text("options"),                                                          // JSON array string for "select"
  sizeFamily:  text("size_family"),                                                      // canonical family
  isRequired:  boolean("is_required").notNull().default(false),
  sortOrder:   integer("sort_order").notNull().default(0),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

export const productAttributeTemplatesRelations = relations(productAttributeTemplates, ({ one }) => ({
  category: one(productCategories, { fields: [productAttributeTemplates.categoryId], references: [productCategories.id] }),
}))

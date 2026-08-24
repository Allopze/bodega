import { relations, sql } from "drizzle-orm"
import { check, index, integer, numeric, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { dteDocuments } from "./dte"
import { products } from "./products"
import { suppliers } from "./worksites"
import { users } from "./users"

/** Copia estructurada de la evidencia cruda del XML; nunca reemplaza el archivo tributario. */
export const dteDocumentItems = pgTable("dte_document_items", {
  id:            text("id").primaryKey(),
  dteDocumentId: text("dte_document_id").notNull().references(() => dteDocuments.id, { onDelete: "cascade" }),
  lineNumber:    integer("line_number").notNull(),
  productCode:   text("product_code"),
  productName:   text("product_name").notNull(),
  description:   text("description"),
  unitOfMeasure: text("unit_of_measure"),
  quantity:      real("quantity").notNull(),
  unitPrice:     numeric("unit_price", { precision: 14, scale: 4, mode: "number" }).notNull(),
  discount:      numeric("discount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  amount:        numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("dte_document_items_line_positive", sql`${table.lineNumber} > 0`),
  check("dte_document_items_quantity_positive", sql`${table.quantity} > 0`),
  check("dte_document_items_amounts_non_negative", sql`
    ${table.unitPrice} >= 0 AND ${table.discount} >= 0 AND ${table.amount} >= 0
  `),
  uniqueIndex("dte_document_items_document_line_unique").on(table.dteDocumentId, table.lineNumber),
  index("dte_document_items_document_idx").on(table.dteDocumentId),
])

/** Alias aprendido sólo desde una confirmación humana sobre evidencia documental. */
export const supplierProductAliases = pgTable("supplier_product_aliases", {
  id:            text("id").primaryKey(),
  supplierId:    text("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  productId:     text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  supplierProductCode: text("supplier_product_code"),
  supplierProductName: text("supplier_product_name"),
  normalizedCode: text("normalized_code"),
  normalizedName: text("normalized_name"),
  unitOfMeasure: text("unit_of_measure"),
  confirmedBy:   text("confirmed_by").notNull().references(() => users.id),
  sourceDteDocumentItemId: text("source_dte_document_item_id").references(() => dteDocumentItems.id, { onDelete: "set null" }),
  confirmedAt:   timestamp("confirmed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("supplier_product_aliases_identity_present", sql`
    ${table.normalizedCode} IS NOT NULL OR ${table.normalizedName} IS NOT NULL
  `),
  uniqueIndex("supplier_product_aliases_supplier_code_unique")
    .on(table.supplierId, table.normalizedCode)
    .where(sql`${table.normalizedCode} IS NOT NULL`),
  uniqueIndex("supplier_product_aliases_supplier_name_unique")
    .on(table.supplierId, table.normalizedName)
    .where(sql`${table.normalizedName} IS NOT NULL`),
  uniqueIndex("supplier_product_aliases_evidence_unique")
    .on(table.supplierId, table.productId, table.sourceDteDocumentItemId)
    .where(sql`${table.sourceDteDocumentItemId} IS NOT NULL`),
  index("supplier_product_aliases_product_idx").on(table.productId),
])

export const dteDocumentItemsRelations = relations(dteDocumentItems, ({ one }) => ({
  document: one(dteDocuments, { fields: [dteDocumentItems.dteDocumentId], references: [dteDocuments.id] }),
}))

export const supplierProductAliasesRelations = relations(supplierProductAliases, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierProductAliases.supplierId], references: [suppliers.id] }),
  product: one(products, { fields: [supplierProductAliases.productId], references: [products.id] }),
  confirmedByUser: one(users, { fields: [supplierProductAliases.confirmedBy], references: [users.id] }),
  sourceDteDocumentItem: one(dteDocumentItems, {
    fields: [supplierProductAliases.sourceDteDocumentItemId],
    references: [dteDocumentItems.id],
  }),
}))

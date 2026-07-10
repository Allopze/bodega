import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { users } from "./users"
import { products } from "./products"
import { suppliers } from "./worksites"

export const eppImportBatches = pgTable("epp_import_batches", {
  id:              text("id").primaryKey(),
  source:          text("source").notNull().default("xlsx"),
  fileName:        text("file_name").notNull(),
  fileHash:        text("file_hash").notNull(),
  status:          text("status").notNull().default("uploaded"),
  headersJson:     text("headers_json").notNull().default("{}"),
  sourceFileJson:  text("source_file_json").notNull().default("{}"),
  sourceFileData:  text("source_file_data").notNull(),
  rulesVersion:    text("rules_version").notNull().default("epp-normalization-v1"),
  createdBy:       text("created_by").notNull().references(() => users.id),
  approvedBy:      text("approved_by").references(() => users.id),
  approvedAt:      timestamp("approved_at", { withTimezone: true, mode: "string" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("epp_import_batches_status_idx").on(table.status, table.createdAt),
  uniqueIndex("epp_import_batches_file_hash_unique").on(table.fileHash),
])

export const eppImportRows = pgTable("epp_import_rows", {
  id:               text("id").primaryKey(),
  batchId:          text("batch_id").notNull().references(() => eppImportBatches.id, { onDelete: "cascade" }),
  rowNumber:        integer("row_number").notNull(),
  sourceCode:       text("source_code"),
  originalJson:     text("original_json").notNull(),
  normalizedJson:   text("normalized_json").notNull(),
  identityKey:      text("identity_key"),
  severity:         text("severity").notNull().default("info"),
  decision:         text("decision").notNull().default("pending"),
  targetProductId:  text("target_product_id").references(() => products.id),
  reviewReason:     text("review_reason"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("epp_import_rows_batch_row_unique").on(table.batchId, table.rowNumber),
  index("epp_import_rows_batch_severity_idx").on(table.batchId, table.severity),
])

export const eppImportCorrections = pgTable("epp_import_corrections", {
  id:             text("id").primaryKey(),
  rowId:          text("row_id").notNull().references(() => eppImportRows.id, { onDelete: "cascade" }),
  field:          text("field").notNull(),
  originalValue:  text("original_value"),
  proposedValue:  text("proposed_value"),
  ruleId:         text("rule_id").notNull(),
  confidence:     integer("confidence").notNull(),
  disposition:    text("disposition").notNull().default("proposed"),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

export const eppImportMatches = pgTable("epp_import_matches", {
  id:              text("id").primaryKey(),
  rowId:           text("row_id").notNull().references(() => eppImportRows.id, { onDelete: "cascade" }),
  productId:        text("product_id").notNull().references(() => products.id),
  score:            integer("score").notNull(),
  reasonsJson:      text("reasons_json").notNull().default("[]"),
  disposition:      text("disposition").notNull().default("proposed"),
}, (table) => [index("epp_import_matches_row_score_idx").on(table.rowId, table.score)])

export const productExternalReferences = pgTable("product_external_references", {
  id:           text("id").primaryKey(),
  productId:    text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  supplierId:   text("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  source:       text("source").notNull(),
  externalCode: text("external_code").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("product_external_references_source_code_unique").on(table.source, table.externalCode),
  index("product_external_references_product_idx").on(table.productId),
])

export const eppImportBatchesRelations = relations(eppImportBatches, ({ one, many }) => ({
  creator: one(users, { fields: [eppImportBatches.createdBy], references: [users.id], relationName: "epp_import_created_by" }),
  approver: one(users, { fields: [eppImportBatches.approvedBy], references: [users.id], relationName: "epp_import_approved_by" }),
  rows: many(eppImportRows),
}))

export const eppImportRowsRelations = relations(eppImportRows, ({ one, many }) => ({
  batch: one(eppImportBatches, { fields: [eppImportRows.batchId], references: [eppImportBatches.id] }),
  targetProduct: one(products, { fields: [eppImportRows.targetProductId], references: [products.id] }),
  corrections: many(eppImportCorrections),
  matches: many(eppImportMatches),
}))

export const eppImportCorrectionsRelations = relations(eppImportCorrections, ({ one }) => ({
  row: one(eppImportRows, { fields: [eppImportCorrections.rowId], references: [eppImportRows.id] }),
}))

export const eppImportMatchesRelations = relations(eppImportMatches, ({ one }) => ({
  row: one(eppImportRows, { fields: [eppImportMatches.rowId], references: [eppImportRows.id] }),
  product: one(products, { fields: [eppImportMatches.productId], references: [products.id] }),
}))

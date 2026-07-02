import { relations } from "drizzle-orm"
import { boolean, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { users } from "../users"
import { workers } from "../worksites"

export const legalDocuments = pgTable("legal_documents", {
  id:                text("id").primaryKey(),
  type:              text("type").notNull(),
  code:              text("code").notNull(),
  title:             text("title").notNull(),
  currentVersionId:  text("current_version_id"),
  mandatory:         boolean("mandatory").notNull().default(true),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("legal_documents_type_code_unique").on(table.type, table.code),
])

export const legalDocumentVersions = pgTable("legal_document_versions", {
  id:            text("id").primaryKey(),
  documentId:    text("document_id").notNull().references(() => legalDocuments.id, { onDelete: "cascade" }),
  version:       integer("version").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo:   text("effective_to"),
  fileUrl:       text("file_url"),
  changelog:     text("changelog"),
  signedBy:      text("signed_by").references(() => users.id),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("legal_document_versions_doc_version_unique").on(table.documentId, table.version),
])

export const documentDeliveries = pgTable("document_deliveries", {
  id:              text("id").primaryKey(),
  versionId:       text("version_id").notNull().references(() => legalDocumentVersions.id),
  workerId:        text("worker_id").notNull().references(() => workers.id),
  deliveredAt:     timestamp("delivered_at", { withTimezone: true, mode: "string" }).notNull(),
  method:          text("method").notNull().default("digital"),
  evidenceUrl:     text("evidence_url"),
  acknowledgedAt:  timestamp("acknowledged_at", { withTimezone: true, mode: "string" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("document_deliveries_version_worker_unique").on(table.versionId, table.workerId),
])

export const documentSignatures = pgTable("document_signatures", {
  id:         text("id").primaryKey(),
  deliveryId: text("delivery_id").notNull().references(() => documentDeliveries.id, { onDelete: "cascade" }),
  userId:     text("user_id").notNull().references(() => users.id),
  signature:  text("signature").notNull(),
  signedAt:   timestamp("signed_at", { withTimezone: true, mode: "string" }).notNull(),
  ip:         text("ip"),
}, (table) => [
  uniqueIndex("document_signatures_delivery_user_unique").on(table.deliveryId, table.userId),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const legalDocumentsRelations = relations(legalDocuments, ({ many }) => ({
  versions: many(legalDocumentVersions),
}))

export const legalDocumentVersionsRelations = relations(legalDocumentVersions, ({ one, many }) => ({
  document:   one(legalDocuments, { fields: [legalDocumentVersions.documentId], references: [legalDocuments.id] }),
  signer:     one(users, { fields: [legalDocumentVersions.signedBy], references: [users.id] }),
  deliveries: many(documentDeliveries),
}))

export const documentDeliveriesRelations = relations(documentDeliveries, ({ one, many }) => ({
  version:     one(legalDocumentVersions, { fields: [documentDeliveries.versionId], references: [legalDocumentVersions.id] }),
  worker:      one(workers, { fields: [documentDeliveries.workerId], references: [workers.id] }),
  signatures:  many(documentSignatures),
}))

export const documentSignaturesRelations = relations(documentSignatures, ({ one }) => ({
  delivery: one(documentDeliveries, { fields: [documentSignatures.deliveryId], references: [documentDeliveries.id] }),
  user:     one(users, { fields: [documentSignatures.userId], references: [users.id] }),
}))

/* ── Types ───────────────────────────────────────────────────────────────── */
export type LegalDocument = typeof legalDocuments.$inferSelect
export type NewLegalDocument = typeof legalDocuments.$inferInsert
export type LegalDocumentVersion = typeof legalDocumentVersions.$inferSelect
export type NewLegalDocumentVersion = typeof legalDocumentVersions.$inferInsert
export type DocumentDelivery = typeof documentDeliveries.$inferSelect
export type NewDocumentDelivery = typeof documentDeliveries.$inferInsert
export type DocumentSignature = typeof documentSignatures.$inferSelect
export type NewDocumentSignature = typeof documentSignatures.$inferInsert

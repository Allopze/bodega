import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable, type AnyPgColumn } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"

export const sstDocumentCategories = pgTable("sst_document_categories", {
  slug:        text("slug").primaryKey(),
  name:        text("name").notNull(),
  description: text("description"),
  sortOrder:   integer("sort_order").notNull().default(0),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export const sstDocumentTypes = pgTable("sst_document_types", {
  id:            text("id").primaryKey(),
  categorySlug:  text("category_slug").notNull().references(() => sstDocumentCategories.slug, { onDelete: "restrict" }),
  code:          text("code").notNull(),
  name:          text("name").notNull(),
  description:   text("description"),
  defaultConfidentiality: text("default_confidentiality").notNull().default("publico_interno"),
  defaultValidityMonths:  integer("default_validity_months"),
  requiresApproval:       boolean("requires_approval").notNull().default(true),
  requiresAcknowledgment: boolean("requires_acknowledgment").notNull().default(false),
  isActive:      boolean("is_active").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("sst_document_types_category_code_unique").on(table.categorySlug, table.code),
])

export const sstDocumentFolders = pgTable("sst_document_folders", {
  id:          text("id").primaryKey(),
  parentId:    text("parent_id").references((): AnyPgColumn => sstDocumentFolders.id, { onDelete: "set null" }),
  name:        text("name").notNull(),
  slug:        text("slug").notNull(),
  worksiteId:  text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  createdBy:   text("created_by").notNull().references(() => users.id),
  archivedAt:  timestamp("archived_at", { withTimezone: true, mode: "string" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("sst_document_folders_parent_slug_unique").on(table.parentId, table.slug),
  index("sst_document_folders_parent_idx").on(table.parentId),
  index("sst_document_folders_worksite_idx").on(table.worksiteId),
])

export const sstDocuments = pgTable("sst_documents", {
  id:               text("id").primaryKey(),
  categorySlug:     text("category_slug").notNull().references(() => sstDocumentCategories.slug, { onDelete: "restrict" }),
  typeId:           text("type_id").references(() => sstDocumentTypes.id, { onDelete: "set null" }),
  folderId:         text("folder_id").references(() => sstDocumentFolders.id, { onDelete: "set null" }),
  internalCode:     text("internal_code"),
  title:            text("title").notNull(),
  description:      text("description"),
  worksiteId:       text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  status:           text("status").notNull().default("borrador"),
  confidentiality:  text("confidentiality").notNull().default("publico_interno"),
  currentVersionId: text("current_version_id"),
  effectiveFrom:    text("effective_from"),
  expiresAt:        text("expires_at"),
  responsibleUserId:text("responsible_user_id").references(() => users.id, { onDelete: "set null" }),
  uploadedBy:       text("uploaded_by").notNull().references(() => users.id),
  reviewedBy:       text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  approvedBy:       text("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt:       timestamp("approved_at", { withTimezone: true, mode: "string" }),
  requiresAcknowledgment: boolean("requires_acknowledgment").notNull().default(false),
  tags:             jsonb("tags").notNull().default(sql`'[]'::jsonb`),
  extraMetadata:    jsonb("extra_metadata").notNull().default(sql`'{}'::jsonb`),
  checksum:         text("checksum"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("sst_documents_category_status_idx").on(table.categorySlug, table.status),
  index("sst_documents_folder_status_idx").on(table.folderId, table.status),
  index("sst_documents_worksite_status_idx").on(table.worksiteId, table.status),
  index("sst_documents_expires_idx").on(table.expiresAt),
  index("sst_documents_responsible_idx").on(table.responsibleUserId),
  check("sst_documents_status_valid", sql`${table.status} IN ('borrador', 'en_revision', 'observado', 'aprobado', 'vigente', 'vencido', 'reemplazado', 'archivado')`),
  check("sst_documents_confidentiality_valid", sql`${table.confidentiality} IN ('publico_interno', 'restringido', 'sensible')`),
])

export const sstDocumentVersions = pgTable("sst_document_versions", {
  id:            text("id").primaryKey(),
  documentId:    text("document_id").notNull().references(() => sstDocuments.id, { onDelete: "cascade" }),
  version:       integer("version").notNull(),
  status:        text("status").notNull().default("borrador"),
  fileName:      text("file_name").notNull(),
  storageName:   text("storage_name").notNull(),
  filePath:      text("file_path").notNull(),
  mimeType:      text("mime_type").notNull(),
  fileSize:      integer("file_size").notNull(),
  checksum:      text("checksum").notNull(),
  effectiveFrom: text("effective_from"),
  effectiveTo:   text("effective_to"),
  changelog:     text("changelog"),
  uploadedBy:    text("uploaded_by").notNull().references(() => users.id),
  reviewedBy:    text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  approvedBy:    text("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt:    timestamp("approved_at", { withTimezone: true, mode: "string" }),
  supersedesId:  text("supersedes_id"),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("sst_document_versions_doc_version_unique").on(table.documentId, table.version),
  index("sst_document_versions_doc_status_idx").on(table.documentId, table.status),
  index("sst_document_versions_checksum_idx").on(table.checksum),
  check("sst_document_versions_status_valid", sql`${table.status} IN ('borrador', 'en_revision', 'observado', 'aprobado', 'vigente', 'reemplazado', 'archivado')`),
  check("sst_document_versions_size_positive", sql`${table.fileSize} > 0`),
])

export const sstDocumentLinks = pgTable("sst_document_links", {
  id:         text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => sstDocuments.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId:   text("entity_id").notNull(),
  notes:      text("notes"),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("sst_document_links_doc_entity_unique").on(table.documentId, table.entityType, table.entityId),
  index("sst_document_links_entity_idx").on(table.entityType, table.entityId),
  check("sst_document_links_entity_type_valid", sql`${table.entityType} IN ('worker', 'worksite', 'vehicle', 'equipment', 'incident', 'training', 'committee', 'epp_delivery', 'corrective_action', 'emergency_plan')`),
])

export const sstDocumentAcknowledgments = pgTable("sst_document_acks", {
  id:          text("id").primaryKey(),
  versionId:   text("version_id").notNull().references(() => sstDocumentVersions.id, { onDelete: "cascade" }),
  userId:      text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  method:      text("method").notNull().default("digital"),
  signature:   text("signature").notNull(),
  ip:          text("ip"),
  userAgent:   text("user_agent"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("sst_document_acks_version_user_unique").on(table.versionId, table.userId),
  index("sst_document_acks_user_idx").on(table.userId),
])

export const sstDocumentAudit = pgTable("sst_document_audit", {
  id:          text("id").primaryKey(),
  documentId:  text("document_id").notNull().references(() => sstDocuments.id, { onDelete: "cascade" }),
  versionId:   text("version_id").references(() => sstDocumentVersions.id, { onDelete: "set null" }),
  action:      text("action").notNull(),
  userId:      text("user_id").references(() => users.id, { onDelete: "set null" }),
  fromStatus:  text("from_status"),
  toStatus:    text("to_status"),
  comment:     text("comment"),
  metadata:    jsonb("metadata"),
  ip:          text("ip"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("sst_document_audit_doc_created_idx").on(table.documentId, table.createdAt),
  index("sst_document_audit_user_idx").on(table.userId),
  check("sst_document_audit_action_valid", sql`${table.action} IN ('create', 'upload', 'view', 'download', 'edit', 'status_change', 'approve', 'observe', 'replace', 'archive', 'ack', 'link', 'unlink', 'delete', 'permission_change')`),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const sstDocumentsRelations = relations(sstDocuments, ({ one, many }) => ({
  category:        one(sstDocumentCategories, { fields: [sstDocuments.categorySlug], references: [sstDocumentCategories.slug] }),
  type:            one(sstDocumentTypes, { fields: [sstDocuments.typeId], references: [sstDocumentTypes.id] }),
  folder:          one(sstDocumentFolders, { fields: [sstDocuments.folderId], references: [sstDocumentFolders.id] }),
  worksite:        one(worksites, { fields: [sstDocuments.worksiteId], references: [worksites.id] }),
  uploader:        one(users, { fields: [sstDocuments.uploadedBy], references: [users.id], relationName: "sstDocumentUploader" }),
  reviewer:        one(users, { fields: [sstDocuments.reviewedBy], references: [users.id], relationName: "sstDocumentReviewer" }),
  approver:        one(users, { fields: [sstDocuments.approvedBy], references: [users.id], relationName: "sstDocumentApprover" }),
  responsible:     one(users, { fields: [sstDocuments.responsibleUserId], references: [users.id], relationName: "sstDocumentResponsible" }),
  versions:        many(sstDocumentVersions),
  links:           many(sstDocumentLinks),
  audit:           many(sstDocumentAudit),
}))

export const sstDocumentFoldersRelations = relations(sstDocumentFolders, ({ one, many }) => ({
  parent:    one(sstDocumentFolders, { fields: [sstDocumentFolders.parentId], references: [sstDocumentFolders.id], relationName: "sstDocumentFolderParent" }),
  children:  many(sstDocumentFolders, { relationName: "sstDocumentFolderParent" }),
  worksite:  one(worksites, { fields: [sstDocumentFolders.worksiteId], references: [worksites.id] }),
  creator:   one(users, { fields: [sstDocumentFolders.createdBy], references: [users.id] }),
  documents: many(sstDocuments),
}))

export const sstDocumentVersionsRelations = relations(sstDocumentVersions, ({ one, many }) => ({
  document:     one(sstDocuments, { fields: [sstDocumentVersions.documentId], references: [sstDocuments.id] }),
  uploader:     one(users, { fields: [sstDocumentVersions.uploadedBy], references: [users.id], relationName: "sstDocVersionUploader" }),
  reviewer:     one(users, { fields: [sstDocumentVersions.reviewedBy], references: [users.id], relationName: "sstDocVersionReviewer" }),
  approver:     one(users, { fields: [sstDocumentVersions.approvedBy], references: [users.id], relationName: "sstDocVersionApprover" }),
  supersedes:   one(sstDocumentVersions, { fields: [sstDocumentVersions.supersedesId], references: [sstDocumentVersions.id], relationName: "sstDocVersionSupersedes" }),
  acks:         many(sstDocumentAcknowledgments),
}))

export const sstDocumentLinksRelations = relations(sstDocumentLinks, ({ one }) => ({
  document: one(sstDocuments, { fields: [sstDocumentLinks.documentId], references: [sstDocuments.id] }),
}))

export const sstDocumentAcknowledgmentsRelations = relations(sstDocumentAcknowledgments, ({ one }) => ({
  version: one(sstDocumentVersions, { fields: [sstDocumentAcknowledgments.versionId], references: [sstDocumentVersions.id] }),
  user:    one(users, { fields: [sstDocumentAcknowledgments.userId], references: [users.id] }),
}))

export const sstDocumentAuditRelations = relations(sstDocumentAudit, ({ one }) => ({
  document: one(sstDocuments, { fields: [sstDocumentAudit.documentId], references: [sstDocuments.id] }),
  version:  one(sstDocumentVersions, { fields: [sstDocumentAudit.versionId], references: [sstDocumentVersions.id] }),
  user:     one(users, { fields: [sstDocumentAudit.userId], references: [users.id] }),
}))

/* ── Types ───────────────────────────────────────────────────────────────── */
export type SstDocumentCategory = typeof sstDocumentCategories.$inferSelect
export type NewSstDocumentCategory = typeof sstDocumentCategories.$inferInsert
export type SstDocumentType = typeof sstDocumentTypes.$inferSelect
export type NewSstDocumentType = typeof sstDocumentTypes.$inferInsert
export type SstDocumentFolder = typeof sstDocumentFolders.$inferSelect
export type NewSstDocumentFolder = typeof sstDocumentFolders.$inferInsert
export type SstDocument = typeof sstDocuments.$inferSelect
export type NewSstDocument = typeof sstDocuments.$inferInsert
export type SstDocumentVersion = typeof sstDocumentVersions.$inferSelect
export type NewSstDocumentVersion = typeof sstDocumentVersions.$inferInsert
export type SstDocumentLink = typeof sstDocumentLinks.$inferSelect
export type NewSstDocumentLink = typeof sstDocumentLinks.$inferInsert
export type SstDocumentAcknowledgment = typeof sstDocumentAcknowledgments.$inferSelect
export type NewSstDocumentAcknowledgment = typeof sstDocumentAcknowledgments.$inferInsert
export type SstDocumentAudit = typeof sstDocumentAudit.$inferSelect
export type NewSstDocumentAudit = typeof sstDocumentAudit.$inferInsert

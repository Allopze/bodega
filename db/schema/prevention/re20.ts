import { check, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { users } from "../users"
import { preventionIncidents } from "./incidents"
import { preventionSensitiveFiles } from "./privacy"

export const preventionIncidentRe20Workspaces = pgTable("prevention_incident_re20_workspaces", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  policyVersion: integer("policy_version").notNull().default(1),
  policySnapshot: jsonb("policy_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  encryptedSensitivePayload: text("encrypted_sensitive_payload"),
  sensitiveIv: text("sensitive_iv"),
  sensitiveAuthTag: text("sensitive_auth_tag"),
  sensitiveKeyVersion: text("sensitive_key_version"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  updatedByUserId: text("updated_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("prevention_incident_re20_workspace_incident_unique").on(table.incidentId),
  check("prevention_incident_re20_workspace_version_positive", sql`${table.version} >= 1`),
  check("prevention_incident_re20_policy_version_positive", sql`${table.policyVersion} >= 1`),
  check("prevention_incident_re20_sensitive_payload_complete", sql`
    (${table.encryptedSensitivePayload} IS NULL AND ${table.sensitiveIv} IS NULL AND ${table.sensitiveAuthTag} IS NULL AND ${table.sensitiveKeyVersion} IS NULL)
    OR (${table.encryptedSensitivePayload} IS NOT NULL AND ${table.sensitiveIv} IS NOT NULL AND ${table.sensitiveAuthTag} IS NOT NULL AND ${table.sensitiveKeyVersion} IS NOT NULL)
  `),
])

export const preventionIncidentRe20QualityReviews = pgTable("prevention_incident_re20_quality_reviews", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  workspaceVersion: integer("workspace_version").notNull(),
  criteria: jsonb("criteria").$type<Array<{ id: string; result: "meets" | "partial" | "does_not_meet"; observation?: string }>>().notNull(),
  decision: text("decision").notNull(),
  observation: text("observation"),
  reviewerRole: text("reviewer_role").notNull().default("RE-20 quality reviewer"),
  reviewerUserId: text("reviewer_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("prevention_incident_re20_review_version_unique").on(table.incidentId, table.workspaceVersion, table.reviewedAt),
  check("prevention_incident_re20_review_version_positive", sql`${table.workspaceVersion} >= 1`),
  check("prevention_incident_re20_review_decision_valid", sql`${table.decision} IN ('approved', 'approved_with_observations', 'changes_required')`),
])

export const preventionIncidentRe20Policy = pgTable("prevention_incident_re20_policy", {
  id: text("id").primaryKey(),
  version: integer("version").notNull().default(1),
  policy: jsonb("policy").$type<Record<string, number>>().notNull(),
  updatedByUserId: text("updated_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  check("prevention_incident_re20_policy_version_positive", sql`${table.version} >= 1`),
])

/** Cada guardado aceptado puede reintentarse desde una cola offline sin duplicar efectos. */
export const preventionIncidentRe20Mutations = pgTable("prevention_incident_re20_mutations", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  mutationId: text("mutation_id").notNull(),
  workspaceVersion: integer("workspace_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("prevention_incident_re20_mutation_unique").on(table.incidentId, table.mutationId),
  check("prevention_incident_re20_mutation_version_positive", sql`${table.workspaceVersion} >= 1`),
])

/** Evidencias RE-20 cifradas en reposo; el nombre y MIME también van cifrados. */
export const preventionIncidentRe20Attachments = pgTable("prevention_incident_re20_attachments", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  clientAttachmentId: text("client_attachment_id").notNull(),
  /** Anexos nuevos: el binario cifrado vive en disco (`prevention_sensitive_files`). */
  sensitiveFileId: text("sensitive_file_id").references(() => preventionSensitiveFiles.id, { onDelete: "restrict" }),
  /** LEGADO: binario en base64 dentro de Postgres. Sólo filas anteriores a la migración a disco;
   *  `scripts/migrate-re20-attachments-to-files.ts` las mueve y una migración posterior elimina estas columnas. */
  encryptedFile: text("encrypted_file"),
  fileIv: text("file_iv"),
  fileAuthTag: text("file_auth_tag"),
  fileKeyVersion: text("file_key_version"),
  encryptedMetadata: text("encrypted_metadata").notNull(),
  metadataIv: text("metadata_iv").notNull(),
  metadataAuthTag: text("metadata_auth_tag").notNull(),
  metadataKeyVersion: text("metadata_key_version").notNull(),
  checksumSha256: text("checksum_sha256").notNull(),
  fileSize: integer("file_size").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("prevention_incident_re20_attachment_client_unique").on(table.incidentId, table.clientAttachmentId),
  uniqueIndex("prevention_incident_re20_attachment_file_unique").on(table.sensitiveFileId),
  check("prevention_incident_re20_attachment_storage_valid", sql`${table.sensitiveFileId} IS NOT NULL OR ${table.encryptedFile} IS NOT NULL`),
  check("prevention_incident_re20_attachment_checksum_valid", sql`length(${table.checksumSha256}) = 64`),
  check("prevention_incident_re20_attachment_size_valid", sql`${table.fileSize} > 0 AND ${table.fileSize} <= 10485760`),
])

export type PreventionIncidentRe20Workspace = typeof preventionIncidentRe20Workspaces.$inferSelect
export type PreventionIncidentRe20QualityReview = typeof preventionIncidentRe20QualityReviews.$inferSelect
export type PreventionIncidentRe20Attachment = typeof preventionIncidentRe20Attachments.$inferSelect

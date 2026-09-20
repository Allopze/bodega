import { relations, sql } from "drizzle-orm"
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { roles, users } from "../users"
import { worksites } from "../worksites"
import type { PdtpScheduleDefinition } from "@/lib/services/pdtp/schedule-definition"

export const pdtpPrograms = pgTable("pdtp_programs", {
  id:                    text("id").primaryKey(),
  year:                  integer("year").notNull(),
  version:               integer("version").notNull(),
  status:                text("status").notNull().default("draft"),
  title:                 text("title").notNull(),
  periodStart:           date("period_start", { mode: "string" }),
  periodEnd:             date("period_end", { mode: "string" }),
  documentCode:          text("document_code"),
  documentRevision:      text("document_revision"),
  validFrom:             date("valid_from", { mode: "string" }),
  validUntil:            date("valid_until", { mode: "string" }),
  indicatorName:         text("indicator_name"),
  indicatorType:         text("indicator_type"),
  indicatorFormula:      text("indicator_formula"),
  indicatorPeriodicity:  text("indicator_periodicity"),
  measurementOwner:      text("measurement_owner"),
  sourceMetadataJson:    jsonb("source_metadata_json").notNull().default({}),
  /**
   * PDTP-003: el programa declara que cubre TODAS las faenas, sin listarlas.
   *
   * Antes esto no se declaraba: no tener faenas asociadas significaba
   * implícitamente "todas", así que un programa a medio configurar y un
   * programa corporativo eran la misma fila. Ahora el alcance total se dice, y
   * un programa sin faenas ni declaración simplemente no acredita —el evento
   * queda visible en el libro de cumplimiento en vez de imputarse a un
   * programa que no lo contempla—.
   */
  appliesToAllWorksites: boolean("applies_to_all_worksites").notNull().default(false),
  creationMode:          text("creation_mode").notNull().default("blank"),
  sourceProgramId:       text("source_program_id"),
  sourceContentVersion:  integer("source_content_version"),
  sourceTemplateVersionId: text("source_template_version_id"),
  elaboratedByUserId:    text("elaborated_by_user_id").references(() => users.id),
  elaboratedByName:      text("elaborated_by_name").notNull(),
  elaboratedByTitle:     text("elaborated_by_title").notNull(),
  approvedByJdprUserId:  text("approved_by_jdpr_user_id").references(() => users.id),
  approvedByJdprAt:      timestamp("approved_by_jdpr_at", { withTimezone: true, mode: "string" }),
  approvedByLegalUserId: text("approved_by_legal_user_id").references(() => users.id),
  approvedByLegalAt:     timestamp("approved_by_legal_at", { withTimezone: true, mode: "string" }),
  contentVersion:        integer("content_version").notNull().default(1),
  contentDigest:         text("content_digest"),
  reviewSnapshotJson:    jsonb("review_snapshot_json"),
  reviewStartedByUserId: text("review_started_by_user_id").references(() => users.id),
  reviewStartedAt:       timestamp("review_started_at", { withTimezone: true, mode: "string" }),
  activatedByUserId:     text("activated_by_user_id").references(() => users.id),
  activatedAt:           timestamp("activated_at", { withTimezone: true, mode: "string" }),
  rejectedByUserId:      text("rejected_by_user_id").references(() => users.id),
  rejectedAt:            timestamp("rejected_at", { withTimezone: true, mode: "string" }),
  rejectionReason:       text("rejection_reason"),
  archivedByUserId:      text("archived_by_user_id").references(() => users.id),
  archivedAt:            timestamp("archived_at", { withTimezone: true, mode: "string" }),
  archiveReason:         text("archive_reason"),
  lastReopenedByUserId:  text("last_reopened_by_user_id").references(() => users.id),
  lastReopenedAt:        timestamp("last_reopened_at", { withTimezone: true, mode: "string" }),
  lastReopenReason:      text("last_reopen_reason"),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  complianceTarget:      numeric("compliance_target", { precision: 5, scale: 2, mode: "number" }).notNull().default(0.9),
  // Pesos del cumplimiento integral (suma 1.0). Defaults 0.5/0.3/0.2.
  pesoEjecucion:         real("peso_ejecucion").notNull().default(0.5),
  pesoVerificacion:      real("peso_verificacion").notNull().default(0.3),
  pesoCierre:            real("peso_cierre").notNull().default(0.2),
}, (table) => [
  // La identidad documental es año + versión: una revisión correctiva v+1
  // convive con la evidencia de la versión que estaba activa.
  uniqueIndex("pdtp_programs_year_version_unique").on(table.year, table.version),
  index("pdtp_programs_status_idx").on(table.status),
  check("pdtp_programs_status_check", sql`${table.status} IN ('draft', 'in_review', 'rejected', 'active', 'closed', 'archived')`),
  check("pdtp_programs_creation_mode_check", sql`${table.creationMode} IN ('blank', 'program_copy', 'template', 'xlsx_import', 'base_2026')`),
  check("pdtp_programs_content_version_check", sql`${table.contentVersion} >= 1`),
  check("pdtp_programs_content_digest_check", sql`${table.contentDigest} IS NULL OR length(${table.contentDigest}) = 64`),
  check("pdtp_programs_compliance_target_check", sql`${table.complianceTarget} >= 0 AND ${table.complianceTarget} <= 1`),
  check("pdtp_programs_year_check", sql`${table.year} BETWEEN 2024 AND 2100`),
  check("pdtp_programs_period_check", sql`${table.periodStart} IS NULL OR ${table.periodEnd} IS NULL OR ${table.periodStart} <= ${table.periodEnd}`),
  check("pdtp_programs_validity_check", sql`${table.validFrom} IS NULL OR ${table.validUntil} IS NULL OR ${table.validFrom} <= ${table.validUntil}`),
  check("pdtp_programs_pesos_sum_check", sql`${table.pesoEjecucion} + ${table.pesoVerificacion} + ${table.pesoCierre} = 1`),
])

export const pdtpProgramTemplates = pgTable("pdtp_program_templates", {
  id:          text("id").primaryKey(),
  code:        text("code").notNull(),
  name:        text("name").notNull(),
  description: text("description"),
  isActive:    boolean("is_active").notNull().default(true),
  createdByUserId: text("created_by_user_id").references(() => users.id),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_program_templates_code_unique").on(table.code),
  check("pdtp_program_templates_code_check", sql`length(${table.code}) > 0`),
  check("pdtp_program_templates_name_check", sql`length(${table.name}) > 0`),
])

export const pdtpProgramTemplateVersions = pgTable("pdtp_program_template_versions", {
  id:                   text("id").primaryKey(),
  templateId:           text("template_id").notNull().references(() => pdtpProgramTemplates.id, { onDelete: "cascade" }),
  version:              integer("version").notNull(),
  sourceProgramId:      text("source_program_id").references(() => pdtpPrograms.id, { onDelete: "set null" }),
  sourceContentVersion: integer("source_content_version").notNull(),
  contentDigest:        text("content_digest").notNull(),
  snapshotJson:         jsonb("snapshot_json").notNull(),
  publishedByUserId:    text("published_by_user_id").references(() => users.id),
  publishedAt:          timestamp("published_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt:            timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_program_template_versions_template_version_unique").on(table.templateId, table.version),
  index("pdtp_program_template_versions_published_idx").on(table.templateId, table.publishedAt),
  check("pdtp_program_template_versions_version_check", sql`${table.version} >= 1`),
  check("pdtp_program_template_versions_digest_check", sql`length(${table.contentDigest}) = 64`),
])

export const pdtpImportBatches = pgTable("pdtp_import_batches", {
  id:                    text("id").primaryKey(),
  programId:             text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  status:                text("status").notNull().default("staged"),
  adapterCode:           text("adapter_code").notNull().default("pdtp_2026_xlsx_v1"),
  sourceFileName:        text("source_file_name").notNull(),
  sourceMimeType:        text("source_mime_type").notNull(),
  sourceSizeBytes:       integer("source_size_bytes").notNull(),
  sourceChecksumSha256:  text("source_checksum_sha256").notNull(),
  previewJson:           jsonb("preview_json").notNull(),
  metadataJson:          jsonb("metadata_json").notNull().default({}),
  warningsJson:          jsonb("warnings_json").notNull().default([]),
  preApplySnapshotJson:  jsonb("pre_apply_snapshot_json"),
  applyResultJson:       jsonb("apply_result_json"),
  targetWorksiteId:      text("target_worksite_id").references(() => worksites.id),
  acceptedMissingEvidence: boolean("accepted_missing_evidence").notNull().default(false),
  acceptanceReason:      text("acceptance_reason"),
  requestedByUserId:     text("requested_by_user_id").notNull().references(() => users.id),
  appliedByUserId:       text("applied_by_user_id").references(() => users.id),
  cancelledByUserId:     text("cancelled_by_user_id").references(() => users.id),
  rolledBackByUserId:    text("rolled_back_by_user_id").references(() => users.id),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  appliedAt:             timestamp("applied_at", { withTimezone: true, mode: "string" }),
  cancelledAt:           timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  cancellationReason:    text("cancellation_reason"),
  rolledBackAt:          timestamp("rolled_back_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  uniqueIndex("pdtp_import_batches_program_checksum_unique").on(table.programId, table.sourceChecksumSha256).where(sql`${table.status} <> 'cancelled'`),
  index("pdtp_import_batches_program_status_idx").on(table.programId, table.status),
  check("pdtp_import_batches_status_check", sql`${table.status} IN ('staged', 'applied', 'cancelled', 'rolled_back', 'failed')`),
  check("pdtp_import_batches_size_check", sql`${table.sourceSizeBytes} > 0`),
  check("pdtp_import_batches_checksum_check", sql`length(${table.sourceChecksumSha256}) = 64`),
  check("pdtp_import_batches_acceptance_reason_check", sql`${table.acceptedMissingEvidence} = false OR length(trim(COALESCE(${table.acceptanceReason}, ''))) >= 10`),
  check("pdtp_import_batches_cancellation_reason_check", sql`${table.status} <> 'cancelled' OR length(trim(COALESCE(${table.cancellationReason}, ''))) >= 10`),
])

export const pdtpImportRows = pgTable("pdtp_import_rows", {
  id:             text("id").primaryKey(),
  batchId:        text("batch_id").notNull().references(() => pdtpImportBatches.id, { onDelete: "cascade" }),
  rowKind:        text("row_kind").notNull(),
  stableKey:      text("stable_key").notNull(),
  severity:       text("severity").notNull().default("info"),
  sourceSheet:    text("source_sheet"),
  sourceCell:     text("source_cell"),
  sourceRow:      integer("source_row"),
  activityNumber: integer("activity_number"),
  payloadJson:    jsonb("payload_json").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_import_rows_batch_key_unique").on(table.batchId, table.stableKey),
  index("pdtp_import_rows_batch_kind_idx").on(table.batchId, table.rowKind),
  check("pdtp_import_rows_kind_check", sql`${table.rowKind} IN ('activity', 'execution', 'metadata', 'warning')`),
  check("pdtp_import_rows_severity_check", sql`${table.severity} IN ('info', 'warning', 'error')`),
])

/** Historia documental declarada por una fuente externa. No equivale a las
 * aprobaciones nativas de Chome: conserva el texto original y solo vincula una
 * identidad interna mediante una reconciliacion explicita y auditada. */
export const pdtpDocumentHistory = pgTable("pdtp_document_history", {
  id:                    text("id").primaryKey(),
  programId:             text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  entryKind:             text("entry_kind").notNull(),
  stableKey:             text("stable_key").notNull(),
  sequence:              integer("sequence").notNull().default(1),
  declaredActorName:     text("declared_actor_name"),
  declaredActorTitle:    text("declared_actor_title"),
  declaredAtText:        text("declared_at_text"),
  description:           text("description"),
  linkedUserId:          text("linked_user_id").references(() => users.id, { onDelete: "set null" }),
  reconciledByUserId:    text("reconciled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reconciledAt:          timestamp("reconciled_at", { withTimezone: true, mode: "string" }),
  reconciliationReason:  text("reconciliation_reason"),
  sourceImportBatchId:   text("source_import_batch_id").references(() => pdtpImportBatches.id, { onDelete: "cascade" }),
  sourceMetadataJson:    jsonb("source_metadata_json").notNull().default({}),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_document_history_source_key_unique").on(table.programId, table.sourceImportBatchId, table.stableKey),
  index("pdtp_document_history_program_kind_idx").on(table.programId, table.entryKind, table.sequence),
  check("pdtp_document_history_kind_check", sql`${table.entryKind} IN ('elaboration', 'review', 'approval', 'change_control')`),
  check("pdtp_document_history_sequence_check", sql`${table.sequence} >= 1`),
  check("pdtp_document_history_reconciliation_check", sql`${table.linkedUserId} IS NULL OR (${table.reconciledByUserId} IS NOT NULL AND ${table.reconciledAt} IS NOT NULL AND length(trim(COALESCE(${table.reconciliationReason}, ''))) >= 10)`),
])

/** Diccionario de roles declarado por una referencia importada. La version de
 * la referencia permanece en `pdtp_import_batches.adapter_code`. */
export const pdtpRoleLegendEntries = pgTable("pdtp_role_legend_entries", {
  id:                  text("id").primaryKey(),
  programId:           text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  code:                text("code").notNull(),
  label:               text("label").notNull(),
  sourceImportBatchId: text("source_import_batch_id").notNull().references(() => pdtpImportBatches.id, { onDelete: "cascade" }),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_role_legend_source_code_unique").on(table.programId, table.sourceImportBatchId, table.code),
  index("pdtp_role_legend_program_idx").on(table.programId, table.code),
  check("pdtp_role_legend_code_check", sql`length(trim(${table.code})) > 0`),
  check("pdtp_role_legend_label_check", sql`length(trim(${table.label})) > 0`),
])

export const pdtpApprovalSteps = pgTable("pdtp_approval_steps", {
  id:                 text("id").primaryKey(),
  programId:          text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  stepOrder:          integer("step_order").notNull(),
  code:               text("code").notNull(),
  label:              text("label").notNull(),
  requiredPermission: text("required_permission").notNull(),
  isRequired:         boolean("is_required").notNull().default(true),
  segregationRules:   jsonb("segregation_rules").notNull().default([]),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_approval_steps_program_order_unique").on(table.programId, table.stepOrder),
  uniqueIndex("pdtp_approval_steps_program_code_unique").on(table.programId, table.code),
  index("pdtp_approval_steps_program_idx").on(table.programId),
  check("pdtp_approval_steps_order_check", sql`${table.stepOrder} >= 1`),
  check("pdtp_approval_steps_code_check", sql`length(${table.code}) > 0`),
  check("pdtp_approval_steps_label_check", sql`length(${table.label}) > 0`),
  check("pdtp_approval_steps_permission_check", sql`length(${table.requiredPermission}) > 0`),
])

export const pdtpApprovalDecisions = pgTable("pdtp_approval_decisions", {
  id:             text("id").primaryKey(),
  programId:      text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  stepId:         text("step_id").references(() => pdtpApprovalSteps.id, { onDelete: "set null" }),
  stepCode:       text("step_code").notNull(),
  stepLabel:      text("step_label").notNull(),
  stepOrder:      integer("step_order").notNull(),
  requiredPermission: text("required_permission").notNull(),
  segregationRulesSnapshot: jsonb("segregation_rules_snapshot").notNull().default([]),
  contentVersion: integer("content_version").notNull(),
  contentDigest:  text("content_digest").notNull(),
  decision:       text("decision").notNull(),
  actorUserId:    text("actor_user_id").notNull().references(() => users.id),
  reason:         text("reason"),
  decidedAt:      timestamp("decided_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_approval_decisions_program_version_code_unique").on(table.programId, table.contentVersion, table.stepCode),
  index("pdtp_approval_decisions_program_version_idx").on(table.programId, table.contentVersion),
  check("pdtp_approval_decisions_step_order_check", sql`${table.stepOrder} >= 1`),
  check("pdtp_approval_decisions_content_version_check", sql`${table.contentVersion} >= 1`),
  check("pdtp_approval_decisions_digest_check", sql`length(${table.contentDigest}) = 64`),
  check("pdtp_approval_decisions_decision_check", sql`${table.decision} IN ('approved', 'rejected')`),
])

export const pdtpResponsibleCatalog = pgTable("pdtp_responsible_catalog", {
  slug:        text("slug").primaryKey(),
  displayName: text("display_name").notNull(),
  roleName:    text("role_name"),
  /**
   * Quién opera la plataforma por este responsable, cuando el responsable no
   * tiene cuenta.
   *
   * Los conductores y operadores son el responsable declarado de la N°25 —el
   * report de uso diario lo llena quien opera el equipo— pero no tienen cuenta,
   * así que su `roleName` es nulo y la cola de pendientes nunca les asignaba
   * trabajo: la actividad quedaba sin dueño visible. La responsabilidad es
   * documental (el nombre del operador va en el formulario) y la operación en la
   * plataforma la hace el jefe de terreno. Decisión D21 del 2026-09-02.
   *
   * No reemplaza al responsable: `displayName` sigue diciendo quién responde.
   */
  operatedByRoleName: text("operated_by_role_name"),
  kind:        text("kind").notNull(),
  notes:       text("notes"),
  isActive:    boolean("is_active").notNull().default(true),
}, (table) => [
  uniqueIndex("pdtp_responsible_catalog_display_unique").on(table.displayName),
])

/** Identidad corporativa estable de una actividad preventiva reutilizable. */
export const pdtpCatalogActivities = pgTable("pdtp_catalog_activities", {
  id:                  text("id").primaryKey(),
  code:                text("code").notNull(),
  status:              text("status").notNull().default("draft"),
  currentRevision:     integer("current_revision").notNull().default(1),
  retiredReason:       text("retired_reason"),
  retiredByUserId:     text("retired_by_user_id").references(() => users.id, { onDelete: "set null" }),
  retiredAt:           timestamp("retired_at", { withTimezone: true, mode: "string" }),
  createdByUserId:     text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_catalog_activities_code_unique").on(table.code),
  index("pdtp_catalog_activities_status_idx").on(table.status),
  check("pdtp_catalog_activities_code_check", sql`${table.code} ~ '^PDT-[A-Z0-9][A-Z0-9-]{2,116}[A-Z0-9]$'`),
  check("pdtp_catalog_activities_status_check", sql`${table.status} IN ('draft', 'active', 'retired')`),
  check("pdtp_catalog_activities_revision_check", sql`${table.currentRevision} >= 1`),
  check("pdtp_catalog_activities_retirement_check", sql`${table.status} <> 'retired' OR (
    length(trim(COALESCE(${table.retiredReason}, ''))) >= 10 AND ${table.retiredAt} IS NOT NULL
  )`),
])

/** Contenido inmutable de una identidad del catálogo. */
export const pdtpCatalogActivityRevisions = pgTable("pdtp_catalog_activity_revisions", {
  id:                  text("id").primaryKey(),
  catalogActivityId:   text("catalog_activity_id").notNull(),
  revision:            integer("revision").notNull(),
  title:               text("title").notNull(),
  description:         text("description").notNull(),
  executionGuidance:   text("execution_guidance").notNull(),
  changeNote:          text("change_note"),
  createdByUserId:     text("created_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.catalogActivityId], foreignColumns: [pdtpCatalogActivities.id], name: "pdtp_revision_catalog_activity_fk" }).onDelete("restrict"),
  uniqueIndex("pdtp_catalog_activity_revisions_identity_unique").on(table.catalogActivityId, table.revision),
  index("pdtp_catalog_activity_revisions_activity_idx").on(table.catalogActivityId, table.revision),
  check("pdtp_catalog_activity_revisions_revision_check", sql`${table.revision} >= 1`),
  check("pdtp_catalog_activity_revisions_title_check", sql`length(trim(${table.title})) BETWEEN 3 AND 80`),
  check("pdtp_catalog_activity_revisions_description_check", sql`length(trim(${table.description})) >= 3`),
  check("pdtp_catalog_activity_revisions_guidance_check", sql`length(trim(${table.executionGuidance})) >= 2`),
])

/** Configuración reusable entre un evento operacional y una identidad. */
export const pdtpAccreditationBindings = pgTable("pdtp_accreditation_bindings", {
  id:                  text("id").primaryKey(),
  sourceType:          text("source_type").notNull(),
  sourceId:            text("source_id").notNull(),
  eventType:           text("event_type").notNull(),
  catalogActivityId:   text("catalog_activity_id").notNull(),
  isActive:            boolean("is_active").notNull().default(true),
  createdByUserId:     text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.catalogActivityId], foreignColumns: [pdtpCatalogActivities.id], name: "pdtp_binding_catalog_activity_fk" }).onDelete("restrict"),
  uniqueIndex("pdtp_accreditation_bindings_unique").on(table.sourceType, table.sourceId, table.eventType, table.catalogActivityId),
  index("pdtp_accreditation_bindings_source_idx").on(table.sourceType, table.sourceId, table.eventType),
  index("pdtp_accreditation_bindings_activity_idx").on(table.catalogActivityId),
  check("pdtp_accreditation_bindings_event_type_check", sql`${table.eventType} IN ('execute', 'review', 'publish', 'acknowledge', 'close', 'complete_drill')`),
])

/**
 * Objetivo del programa (banda vertical del Excel RE-36 que agrupa
 * actividades). Declarada aquí, antes de `pdtpActivities`, porque su FK
 * compuesta referencia estas columnas.
 */
export const pdtpObjectives = pgTable("pdtp_objectives", {
  id:           text("id").primaryKey(),
  programId:    text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  code:         text("code").notNull(),
  name:         text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_objectives_program_code_unique").on(table.programId, table.code),
  uniqueIndex("pdtp_objectives_program_id_unique").on(table.programId, table.id),
  check("pdtp_objectives_code_check", sql`length(trim(${table.code})) > 0`),
  check("pdtp_objectives_name_check", sql`length(trim(${table.name})) > 0`),
  check("pdtp_objectives_display_order_check", sql`${table.displayOrder} >= 0`),
])

export const pdtpActivities = pgTable("pdtp_activities", {
  id:                 text("id").primaryKey(),
  programId:          text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  n:                  integer("n").notNull(),
  catalogActivityId:  text("catalog_activity_id"),
  catalogRevision:    integer("catalog_revision"),
  objectiveId:        text("objective_id"),
  displayOrder:       integer("display_order").notNull().default(0),
  status:             text("status").notNull().default("active"),
  retiredReason:      text("retired_reason"),
  retiredEffectiveFrom: date("retired_effective_from", { mode: "string" }),
  retiredByUserId:    text("retired_by_user_id").references(() => users.id),
  retiredAt:          timestamp("retired_at", { withTimezone: true, mode: "string" }),
  activity:           text("activity").notNull(),
  program:            text("program").notNull(),
  responsibleSlugs:   jsonb("responsible_slugs").notNull(),
  responsibleDisplay: text("responsible_display").notNull(),
  audienceRoles:       jsonb("audience_roles").notNull().default([]),
  scheduleMode:        text("schedule_mode").notNull().default("scheduled"),
  scheduleClassificationStatus: text("schedule_classification_status").notNull().default("confirmed"),
  recurrenceRule:      jsonb("recurrence_rule"),
  /** Fuente de verdad para actividades creadas con el calendario nuevo.
   * `null` conserva filas antiguas hasta que el backfill las marque como
   * `legacy_grid`; nunca se reconstruyen fechas históricas a partir de la
   * grilla 1..4. */
  scheduleDefinition:  jsonb("schedule_definition").$type<PdtpScheduleDefinition | null>(),
  triggerType:         text("trigger_type"),
  triggerDescription:  text("trigger_description"),
  dueDays:             integer("due_days"),
  /**
   * Plazo en horas, para las obligaciones que la norma fija por debajo de un
   * día (la DIAT, el informe preliminar del RE-20). `dueDays` no alcanza para
   * "≤3 horas" porque es un entero de días — en vez de forzar esos casos a
   * redondear a un día completo, se agrega esta columna hermana. Sólo una de
   * las dos debe estar presente por actividad (ver el CHECK); el resolutor de
   * `dueAt` usa horas si están, si no cae a días.
   */
  dueHours:            integer("due_hours"),
  evidenceRequirement: text("evidence_requirement"),
  /**
   * Cómo se cumple esta actividad (D4 del diseño 2026-08-12). Hasta ahora la
   * clasificación vivía sólo en el documento y el código no podía consultarla:
   *
   *   `enganche`   un registro de otro módulo la cierra; nadie marca en PDTP
   *   `constancia` se hizo o no se hizo + evidencia u observación
   *   `formulario` hay que crear el registro dentro de PDTP
   *   `compuesta`  se cumple cuando sus componentes están completos (N°52)
   *   `sin_definir` todavía no clasificada
   *
   * El submódulo Constancias lista exactamente las `constancia`.
   */
  mechanism:           text("mechanism").notNull().default("sin_definir"),
  indicatorMode:       text("indicator_mode").notNull().default("planned_vs_completed"),
  /**
   * De qué registro sale el padrón cuando `indicatorMode = 'coverage'`.
   *
   * Es la hermana de `indicatorMode`: esa columna dice "mídase cuántos de
   * cuántos" y esta dice contra qué. Sin ella la base declaraba el modo y no la
   * población, que para un programa que se firma y se audita es un hueco.
   *
   *   `dotacion`            trabajadores activos de la faena
   *   `extintores`          extintores del inventario de recursos de emergencia
   *   `expuestos_ges`       personas en un GES con vigilancia requerida
   *   `equipos`             vehículos y equipos activos de la faena
   *   `trabajadores_nuevos` actas de trabajador nuevo cerradas en el período
   *   `trabajadores_capacidad` trabajadores activos cuyo cargo o excepción
   *                            individual posee una capacidad configurada
   *   `null`                sin fuente: se usa el padrón cargado a mano y, si no
   *                         hay, la cantidad planificada del mes
   *
   * Las cuatro primeras son de **stock** —cuántos sujetos existen ahora— y la
   * última de **flujo**: cuántos casos ocurrieron en el mes. La diferencia
   * importa en el cálculo, porque un flujo debe contar en meses sin calendario.
   */
  subjectSource:       text("subject_source"),
  /** Códigos del catálogo `worker_capabilities` que se combinan como OR para
   *  `trabajadores_capacidad`. Se guardan en la actividad porque el método de
   *  selección forma parte del contenido que se revisa y firma. */
  subjectCapabilityCodes: text("subject_capability_codes").array(),
  targetValue:         numeric("target_value", { precision: 10, scale: 2, mode: "number" }),
  targetUnit:          text("target_unit"),
  sourceSheetRow:     integer("source_sheet_row").notNull(),
  notes:              text("notes"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_activities_program_n_unique").on(table.programId, table.n),
  uniqueIndex("pdtp_activities_program_catalog_unique").on(table.programId, table.catalogActivityId),
  foreignKey({
    columns: [table.catalogActivityId, table.catalogRevision],
    foreignColumns: [pdtpCatalogActivityRevisions.catalogActivityId, pdtpCatalogActivityRevisions.revision],
    name: "pdtp_activities_catalog_revision_fk",
  }).onDelete("restrict"),
  // ⚠️ Esta declaración SUBREPRESENTA la constraint real. `ForeignKeyBuilder
  // .onDelete()` de Drizzle sólo acepta un string de acción ("cascade" |
  // "set null" | ...) — no hay forma de listar columnas — así que esta línea
  // sólo puede decir "ON DELETE SET NULL" a secas. En la base de datos, la
  // migración `0302_pdtp_objective_fk_set_null_column.sql` la redeclaró como
  // `ON DELETE SET NULL ("objective_id")` (columna específica, PG15+): sin
  // eso, Postgres nulifica TODAS las columnas de la FK compuesta al borrar
  // el objetivo referenciado, incluida `program_id`, que es NOT NULL, y
  // revienta con 23502 (ver I3, ronda de arreglos de la tarea 1.2 PDTP).
  // El snapshot de `drizzle-kit` tampoco distingue las dos formas —
  // `0301_snapshot.json` y `0302_snapshot.json` son idénticos en esta FK—,
  // así que NO hay ninguna herramienta que detecte una regeneración
  // accidental. Si algún día se regenera esta FK desde este archivo (p. ej.
  // `drizzle-kit generate` tras tocar esta tabla), va a volver a la forma
  // rota sin lista de columnas — hay que reescribir la migración generada a
  // mano con `ON DELETE SET NULL ("objective_id")`, igual que la 0302. La
  // red de seguridad es `db/schema-consistency.test.ts` ("borrar un objetivo
  // PDTP deja objective_id en NULL sin tocar program_id"): si esto se
  // revierte, ese test se cae.
  foreignKey({
    columns: [table.programId, table.objectiveId],
    foreignColumns: [pdtpObjectives.programId, pdtpObjectives.id],
    name: "pdtp_activities_objective_same_program_fk",
  }).onDelete("set null"),
  index("pdtp_activities_program_objective_idx").on(table.programId, table.objectiveId),
  index("pdtp_activities_program_display_order_idx").on(table.programId, table.displayOrder),
  check("pdtp_activities_n_check", sql`${table.n} >= 1`),
  check("pdtp_activities_catalog_revision_pair_check", sql`(${table.catalogActivityId} IS NULL) = (${table.catalogRevision} IS NULL)`),
  check("pdtp_activities_display_order_check", sql`${table.displayOrder} >= 0`),
  check("pdtp_activities_status_check", sql`${table.status} IN ('active', 'retired')`),
  check("pdtp_activities_retirement_check", sql`${table.status} = 'active' OR (
    length(trim(COALESCE(${table.retiredReason}, ''))) >= 10
    AND ${table.retiredEffectiveFrom} IS NOT NULL
    AND ${table.retiredAt} IS NOT NULL
  )`),
  check("pdtp_activities_schedule_mode_check", sql`${table.scheduleMode} IN ('scheduled', 'on_demand', 'triggered')`),
  check("pdtp_activities_schedule_classification_check", sql`${table.scheduleClassificationStatus} IN ('confirmed', 'needs_review')`),
  check("pdtp_activities_due_days_check", sql`${table.dueDays} IS NULL OR ${table.dueDays} >= 0`),
  check("pdtp_activities_due_hours_check", sql`${table.dueHours} IS NULL OR ${table.dueHours} >= 0`),
  // Un plazo se declara en una sola unidad. Las dos juntas serían ambiguas
  // (¿se suman? ¿manda la más corta?) y ninguna actividad del catálogo 2026
  // necesita ambas.
  check("pdtp_activities_due_days_hours_exclusive", sql`${table.dueDays} IS NULL OR ${table.dueHours} IS NULL`),
  check("pdtp_activities_mechanism_check", sql`${table.mechanism} IN ('enganche', 'constancia', 'formulario', 'compuesta', 'sin_definir')`),
  check("prevention_pdtp_activity_indicator_mode_valid", sql`${table.indicatorMode} IN ('planned_vs_completed', 'closed_on_time', 'completed_count', 'not_applicable', 'coverage')`),
  check("pdtp_activities_subject_source_check", sql`${table.subjectSource} IS NULL OR ${table.subjectSource} IN ('dotacion', 'extintores', 'expuestos_ges', 'equipos', 'trabajadores_nuevos', 'trabajadores_capacidad')`),
  // Declarar una fuente de padrón sin medir por cobertura no significa nada: el
  // resto de los modos no tiene denominador de sujetos.
  check("pdtp_activities_subject_source_requires_coverage", sql`${table.subjectSource} IS NULL OR ${table.indicatorMode} = 'coverage'`),
  check("pdtp_activities_subject_capabilities_check", sql`(
    ${table.subjectSource} = 'trabajadores_capacidad'
    AND COALESCE(cardinality(${table.subjectCapabilityCodes}), 0) > 0
  ) OR (
    ${table.subjectSource} IS DISTINCT FROM 'trabajadores_capacidad'
    AND ${table.subjectCapabilityCodes} IS NULL
  )`),
  check("pdtp_activities_target_value_check", sql`${table.targetValue} IS NULL OR ${table.targetValue} >= 0`),
])

/**
 * Roles que acreditan el hecho operacional de una actividad.
 *
 * Esta asignación no reemplaza `responsibleSlugs`: éstos representan quién
 * planifica o responde por la medida. El ejecutor representa quién tiene que
 * entrar al módulo de destino y registrar el hecho, permitiendo flujos
 * segregados sin otorgar permisos ni alterar responsabilidades documentales.
 */
export const pdtpActivityExecutorAssignments = pgTable("pdtp_activity_executor_assignments", {
  id:          text("id").primaryKey(),
  activityId:  text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  roleId:      text("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_activity_executor_assignments_activity_role_unique").on(table.activityId, table.roleId),
  index("pdtp_activity_executor_assignments_role_idx").on(table.roleId),
])

/** Configuración anual del destino operacional y de su criterio de cierre. */
export const pdtpActivityExecutionConfigs = pgTable("pdtp_activity_execution_configs", {
  id:                     text("id").primaryKey(),
  activityId:             text("activity_id").notNull(),
  destinationConnectorKey: text("destination_connector_key").notNull(),
  accreditationBindingId: text("accreditation_binding_id"),
  completionPolicy:       text("completion_policy").notNull().default("manual_confirmed"),
  evidenceRequired:       boolean("evidence_required").notNull().default(false),
  acceptedEvidenceKinds:  jsonb("accepted_evidence_kinds").notNull().default([]),
  createdAt:              timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:              timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_activity_execution_configs_activity_unique").on(table.activityId),
  index("pdtp_activity_execution_configs_connector_idx").on(table.destinationConnectorKey),
  foreignKey({ columns: [table.activityId], foreignColumns: [pdtpActivities.id], name: "pdtp_exec_cfg_activity_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.accreditationBindingId], foreignColumns: [pdtpAccreditationBindings.id], name: "pdtp_exec_cfg_binding_fk" }).onDelete("set null"),
  check("pdtp_activity_execution_configs_policy_check", sql`${table.completionPolicy} IN ('manual_confirmed', 'source_completed', 'source_approved', 'checklist_completed')`),
  check("pdtp_activity_execution_configs_evidence_kinds_check", sql`jsonb_typeof(${table.acceptedEvidenceKinds}) = 'array'`),
])

/**
 * Decisión explícita sobre una diferencia entre una revisión anual y la Base
 * preventiva vigente. `kept` no altera el programa; `applied` es el registro
 * auditable de que el operador adoptó la diferencia concreta de la Base.
 */
export const pdtpRevisionDiffDecisions = pgTable("pdtp_revision_diff_decisions", {
  id:                    text("id").primaryKey(),
  programId:             text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  baseTemplateVersionId: text("base_template_version_id").notNull(),
  activityIdentity:      text("activity_identity").notNull(),
  decision:              text("decision").notNull(),
  decidedByUserId:       text("decided_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  decidedAt:             timestamp("decided_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_revision_diff_decisions_program_base_identity_unique").on(table.programId, table.baseTemplateVersionId, table.activityIdentity),
  index("pdtp_revision_diff_decisions_program_idx").on(table.programId),
  foreignKey({
    columns: [table.baseTemplateVersionId],
    foreignColumns: [pdtpProgramTemplateVersions.id],
    name: "pdtp_rev_diff_base_version_fk",
  }).onDelete("restrict"),
  check("pdtp_revision_diff_decisions_identity_check", sql`length(trim(${table.activityIdentity})) > 0`),
  check("pdtp_revision_diff_decisions_decision_check", sql`${table.decision} IN ('applied', 'kept')`),
])

export const pdtpActivitySchedule = pgTable("pdtp_activity_schedule", {
  id:              text("id").primaryKey(),
  activityId:      text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  year:            integer("year").notNull(),
  month:           integer("month").notNull(),
  week:            integer("week").notNull(),
  plannedQuantity: numeric("planned_quantity", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
  sourceColumn:    text("source_column").notNull(),
}, (table) => [
  uniqueIndex("pdtp_activity_schedule_activity_period_unique").on(table.activityId, table.year, table.month, table.week),
  index("pdtp_activity_schedule_year_month_idx").on(table.year, table.month),
  check("pdtp_activity_schedule_month_check", sql`${table.month} BETWEEN 1 AND 12`),
  check("pdtp_activity_schedule_week_check", sql`${table.week} BETWEEN 1 AND 4`),
  check("pdtp_activity_schedule_quantity_check", sql`${table.plannedQuantity} >= 0`),
])

/** Ocurrencia fechada e independiente de la definición anual. */
export const pdtpScheduledInstances = pgTable("pdtp_scheduled_instances", {
  id:                    text("id").primaryKey(),
  programId:             text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  activityId:            text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  worksiteId:            text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  scheduledFor:          date("scheduled_for", { mode: "string" }).notNull(),
  isoWeekYear:           integer("iso_week_year").notNull(),
  isoWeek:               integer("iso_week").notNull(),
  plannedQuantity:       numeric("planned_quantity", { precision: 10, scale: 2, mode: "number" }).notNull().default(1),
  status:                text("status").notNull().default("pending"),
  responsibleSlug:       text("responsible_slug"),
  responsibleUserId:     text("responsible_user_id").references(() => users.id, { onDelete: "set null" }),
  responsibleRoleSnapshot: text("responsible_role_snapshot"),
  startedAt:             timestamp("started_at", { withTimezone: true, mode: "string" }),
  startedByUserId:       text("started_by_user_id").references(() => users.id, { onDelete: "set null" }),
  completedAt:           timestamp("completed_at", { withTimezone: true, mode: "string" }),
  completedByUserId:     text("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  notApplicableReason:   text("not_applicable_reason"),
  cancelledAt:           timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  cancelledByUserId:     text("cancelled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  cancellationReason:    text("cancellation_reason"),
  idempotencyKey:        text("idempotency_key").notNull(),
  sourceMetadataJson:    jsonb("source_metadata_json").notNull().default({}),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_scheduled_instances_idempotency_unique").on(table.idempotencyKey),
  uniqueIndex("pdtp_scheduled_instances_activity_worksite_date_unique").on(table.activityId, table.worksiteId, table.scheduledFor),
  index("pdtp_scheduled_instances_program_period_idx").on(table.programId, table.scheduledFor),
  index("pdtp_scheduled_instances_worksite_status_idx").on(table.worksiteId, table.status, table.scheduledFor),
  check("pdtp_scheduled_instances_status_check", sql`${table.status} IN ('pending', 'in_progress', 'submitted', 'completed', 'not_applicable', 'cancelled')`),
  check("pdtp_scheduled_instances_iso_week_check", sql`${table.isoWeek} BETWEEN 1 AND 53`),
  check("pdtp_scheduled_instances_quantity_check", sql`${table.plannedQuantity} > 0`),
  check("pdtp_scheduled_instances_not_applicable_reason_check", sql`${table.status} <> 'not_applicable' OR length(trim(COALESCE(${table.notApplicableReason}, ''))) >= 3`),
  check("pdtp_scheduled_instances_cancel_reason_check", sql`${table.status} <> 'cancelled' OR length(trim(COALESCE(${table.cancellationReason}, ''))) >= 3`),
])

/** Ocurrencia ejecutable de una actividad. Para `triggered` y `on_demand`
 * constituye el denominador real; no se infiere una cuota cuando no hubo
 * casos. La fuente e idempotencyKey permiten enlazar eventos operacionales
 * sin duplicar cumplimiento. */
export const pdtpObligations = pgTable("pdtp_obligations", {
  id:                text("id").primaryKey(),
  programId:         text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  activityId:        text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id),
  mode:              text("mode").notNull(),
  status:            text("status").notNull().default("pending"),
  triggerType:       text("trigger_type"),
  sourceType:        text("source_type"),
  sourceId:          text("source_id"),
  sourceOccurredAt:  timestamp("source_occurred_at", { withTimezone: true, mode: "string" }),
  dueAt:             timestamp("due_at", { withTimezone: true, mode: "string" }),
  plannedQuantity:   numeric("planned_quantity", { precision: 10, scale: 2, mode: "number" }).notNull().default(1),
  completedQuantity: numeric("completed_quantity", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
  idempotencyKey:    text("idempotency_key").notNull(),
  origin:            text("origin").notNull(),
  manualReason:      text("manual_reason"),
  sourceMetadataJson: jsonb("source_metadata_json").notNull().default({}),
  createdByUserId:   text("created_by_user_id").references(() => users.id),
  reportedAt:        timestamp("reported_at", { withTimezone: true, mode: "string" }),
  completedAt:       timestamp("completed_at", { withTimezone: true, mode: "string" }),
  cancelledByUserId: text("cancelled_by_user_id").references(() => users.id),
  cancelledAt:       timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  cancellationReason: text("cancellation_reason"),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_obligations_idempotency_key_unique").on(table.idempotencyKey),
  index("pdtp_obligations_scope_status_due_idx").on(table.worksiteId, table.status, table.dueAt),
  index("pdtp_obligations_program_mode_idx").on(table.programId, table.mode),
  index("pdtp_obligations_source_idx").on(table.sourceType, table.sourceId),
  check("pdtp_obligations_mode_check", sql`${table.mode} IN ('on_demand', 'triggered')`),
  check("pdtp_obligations_status_check", sql`${table.status} IN ('pending', 'overdue', 'reported', 'completed', 'cancelled')`),
  check("pdtp_obligations_origin_check", sql`${table.origin} IN ('manual', 'integration')`),
  check("pdtp_obligations_quantity_check", sql`${table.plannedQuantity} > 0 AND ${table.completedQuantity} >= 0`),
  check("pdtp_obligations_manual_reason_check", sql`${table.origin} <> 'manual' OR length(trim(COALESCE(${table.manualReason}, ''))) >= 10`),
  check("pdtp_obligations_cancel_reason_check", sql`${table.status} <> 'cancelled' OR length(trim(COALESCE(${table.cancellationReason}, ''))) >= 10`),
])

export const pdtpExecutions = pgTable("pdtp_executions", {
  id:               text("id").primaryKey(),
  activityId:       text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id),
  year:             integer("year").notNull(),
  month:            integer("month").notNull(),
  week:             integer("week").notNull(),
  executedQuantity: numeric("executed_quantity", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
  status:           text("status").notNull().default("draft"),
  evidenceText:     text("evidence_text"),
  evidenceUrl:      text("evidence_url"),
  evidencePhotos:   jsonb("evidence_photos").notNull().default([]),
  executedByUserId: text("executed_by_user_id").references(() => users.id),
  executedAt:       timestamp("executed_at", { withTimezone: true, mode: "string" }),
  approvedByUserId: text("approved_by_user_id").references(() => users.id),
  approvedAt:       timestamp("approved_at", { withTimezone: true, mode: "string" }),
  rejectedByUserId: text("rejected_by_user_id").references(() => users.id),
  rejectedAt:       timestamp("rejected_at", { withTimezone: true, mode: "string" }),
  rejectionReason:  text("rejection_reason"),
  origin:            text("origin").notNull().default("manual"),
  sourceType:        text("source_type"),
  sourceId:          text("source_id"),
  idempotencyKey:    text("idempotency_key"),
  importBatchId:     text("import_batch_id").references(() => pdtpImportBatches.id, { onDelete: "set null" }),
  sourceMetadataJson: jsonb("source_metadata_json").notNull().default({}),
  evidenceStatus:    text("evidence_status").notNull().default("pending"),
  obligationId:      text("obligation_id").references(() => pdtpObligations.id, { onDelete: "set null" }),
  scheduledInstanceId: text("scheduled_instance_id"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  // Una sola carga editable/manual por celda. Las integraciones tienen su propia
  // identidad (`idempotency_key`) y pueden coexistir en el mismo período: así
  // una inspección no aprueba ni sobrescribe una carga humana pendiente y dos
  // inspecciones simultáneas no compiten por la misma fila física.
  uniqueIndex("pdtp_executions_activity_scope_period_unique").on(table.activityId, table.worksiteId, table.year, table.month, table.week).where(sql`${table.obligationId} IS NULL AND ${table.origin} <> 'integration'`),
  uniqueIndex("pdtp_executions_obligation_unique").on(table.obligationId),
  index("pdtp_executions_worksite_period_idx").on(table.worksiteId, table.year, table.month),
  index("pdtp_executions_status_idx").on(table.status),
  uniqueIndex("pdtp_executions_idempotency_key_unique").on(table.idempotencyKey),
  uniqueIndex("pdtp_executions_scheduled_instance_unique").on(table.scheduledInstanceId),
  index("pdtp_executions_import_batch_idx").on(table.importBatchId),
  index("pdtp_executions_scheduled_instance_idx").on(table.scheduledInstanceId),
  foreignKey({ columns: [table.scheduledInstanceId], foreignColumns: [pdtpScheduledInstances.id], name: "pdtp_exec_scheduled_instance_fk" }).onDelete("set null"),
  check("pdtp_executions_status_check", sql`${table.status} IN ('draft', 'submitted', 'approved', 'rejected')`),
  check("pdtp_executions_month_check", sql`${table.month} BETWEEN 1 AND 12`),
  check("pdtp_executions_week_check", sql`${table.week} BETWEEN 1 AND 4`),
  check("pdtp_executions_quantity_check", sql`${table.executedQuantity} >= 0`),
  check("pdtp_executions_origin_check", sql`${table.origin} IN ('manual', 'xlsx_import', 'integration')`),
  check("pdtp_executions_evidence_status_check", sql`${table.evidenceStatus} IN ('pending', 'provided', 'not_required', 'migrated_without_attachment')`),
])

/** Offset configurable para avisar una instancia fechada. Un valor negativo
 * ocurre antes del vencimiento; cero el día/hora objetivo; positivo después. */
export const pdtpActivityReminderRules = pgTable("pdtp_activity_reminder_rules", {
  id:                text("id").primaryKey(),
  activityId:        text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  offsetValue:       integer("offset_value").notNull(),
  offsetUnit:        text("offset_unit").notNull().default("day"),
  recipientKind:     text("recipient_kind").notNull().default("responsible"),
  recipientUserId:   text("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
  isActive:          boolean("is_active").notNull().default(true),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("pdtp_activity_reminder_rules_activity_idx").on(table.activityId, table.isActive),
  check("pdtp_activity_reminder_rules_unit_check", sql`${table.offsetUnit} IN ('hour', 'day')`),
  check("pdtp_activity_reminder_rules_recipient_check", sql`${table.recipientKind} IN ('responsible', 'role', 'user')`),
  check("pdtp_activity_reminder_rules_user_recipient_check", sql`${table.recipientKind} = 'user' OR ${table.recipientUserId} IS NULL`),
])

export const pdtpReminderDeliveries = pgTable("pdtp_reminder_deliveries", {
  id:                 text("id").primaryKey(),
  scheduledInstanceId: text("scheduled_instance_id").notNull(),
  reminderRuleId:     text("reminder_rule_id").notNull(),
  recipientUserId:    text("recipient_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status:             text("status").notNull().default("sent"),
  deliveredAt:        timestamp("delivered_at", { withTimezone: true, mode: "string" }),
  errorMessage:       text("error_message"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_reminder_deliveries_dedupe_unique").on(table.scheduledInstanceId, table.reminderRuleId, table.recipientUserId),
  index("pdtp_reminder_deliveries_status_idx").on(table.status, table.createdAt),
  foreignKey({ columns: [table.scheduledInstanceId], foreignColumns: [pdtpScheduledInstances.id], name: "pdtp_reminder_delivery_instance_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.reminderRuleId], foreignColumns: [pdtpActivityReminderRules.id], name: "pdtp_reminder_delivery_rule_fk" }).onDelete("cascade"),
  check("pdtp_reminder_deliveries_status_check", sql`${table.status} IN ('sent', 'failed')`),
])

/** Libro durable de señales emitidas por conectores. La clave única permite
 * reintentar un evento sin crear obligaciones idénticas. */
export const pdtpTriggerEvents = pgTable("pdtp_trigger_events", {
  id:                 text("id").primaryKey(),
  connectorKey:       text("connector_key").notNull(),
  eventKey:           text("event_key").notNull(),
  sourceType:         text("source_type").notNull(),
  sourceId:           text("source_id").notNull(),
  // El libro es durable mientras la faena existe; si una faena se elimina de
  // una base de pruebas o por una purga administrativa, sus señales ya no
  // pueden reconciliarse y se eliminan junto con el alcance que las originó.
  worksiteId:         text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  occurredAt:         timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  idempotencyKey:     text("idempotency_key").notNull(),
  payloadJson:        jsonb("payload_json").notNull().default({}),
  status:             text("status").notNull().default("pending"),
  obligationId:      text("obligation_id").references(() => pdtpObligations.id, { onDelete: "set null" }),
  processedAt:        timestamp("processed_at", { withTimezone: true, mode: "string" }),
  attempts:           integer("attempts").notNull().default(0),
  lastError:          text("last_error"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_trigger_events_idempotency_unique").on(table.idempotencyKey),
  index("pdtp_trigger_events_pending_idx").on(table.status, table.occurredAt),
  index("pdtp_trigger_events_connector_event_idx").on(table.connectorKey, table.eventKey),
  check("pdtp_trigger_events_status_check", sql`${table.status} IN ('pending', 'processed', 'ignored', 'error')`),
  check("pdtp_trigger_events_attempts_check", sql`${table.attempts} >= 0`),
])

/**
 * Desvíos por celda (actividad × faena × año/mes/semana): la explicación de
 * por qué una celda no tiene una ejecución "normal" — no se hizo, no aplica,
 * o se reprogramó para otra celda.
 *
 * No es un estado nuevo en `pdtp_executions` a propósito: esa tabla tiene un
 * índice único parcial que admite una sola fila manual por celda
 * (`pdtp_executions_activity_scope_period_unique`), pensado para que una
 * carga humana pendiente no compita con una integración. Meter "no
 * realizada" ahí colisionaría con esa fila manual y obligaría a tocar el
 * CHECK de `status` y todos los consumidores de `status IN ('submitted',
 * 'approved')`. Además un desvío es un hecho operacional, no contenido del
 * documento firmado: no debe entrar en la huella de `content-digest.ts`, así
 * que vive en su propia tabla, fuera de lo que el hash del programa cubre.
 */
export const pdtpExecutionDeviations = pgTable("pdtp_execution_deviations", {
  id:                 text("id").primaryKey(),
  activityId:         text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  worksiteId:         text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  year:               integer("year").notNull(),
  month:              integer("month").notNull(),
  week:               integer("week").notNull(),
  kind:               text("kind").notNull(),
  reason:             text("reason").notNull(),
  /** Sólo para `kind = 'reprogrammed'`: la celda destino. */
  targetMonth:        integer("target_month"),
  targetWeek:         integer("target_week"),
  status:             text("status").notNull().default("active"),
  createdByUserId:    text("created_by_user_id").notNull().references(() => users.id),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  withdrawnByUserId:  text("withdrawn_by_user_id").references(() => users.id),
  withdrawnAt:        timestamp("withdrawn_at", { withTimezone: true, mode: "string" }),
  withdrawReason:     text("withdraw_reason"),
}, (table) => [
  // Una sola celda puede tener un desvío activo a la vez; retirar uno libera
  // la celda para registrar otro. Sin el WHERE, un desvío retirado
  // bloquearía indefinidamente registrar uno nuevo en la misma celda.
  uniqueIndex("pdtp_execution_deviations_cell_active_unique").on(table.activityId, table.worksiteId, table.year, table.month, table.week).where(sql`${table.status} = 'active'`),
  index("pdtp_execution_deviations_worksite_period_idx").on(table.worksiteId, table.year, table.month),
  check("pdtp_execution_deviations_month_check", sql`${table.month} BETWEEN 1 AND 12`),
  check("pdtp_execution_deviations_week_check", sql`${table.week} BETWEEN 1 AND 4`),
  check("pdtp_execution_deviations_kind_check", sql`${table.kind} IN ('not_performed', 'not_applicable', 'reprogrammed')`),
  check("pdtp_execution_deviations_reason_check", sql`length(trim(${table.reason})) >= 10`),
  check("pdtp_execution_deviations_status_check", sql`${table.status} IN ('active', 'withdrawn')`),
  // Equivalencia, no implicación: un `reprogrammed` SIEMPRE trae destino, y
  // ningún otro tipo lo trae.
  check("pdtp_execution_deviations_target_check", sql`(${table.kind} <> 'reprogrammed') = (${table.targetMonth} IS NULL AND ${table.targetWeek} IS NULL)`),
  // La equivalencia de arriba sólo exige que no sean AMBOS NULL: un destino a
  // medias (mes sin semana o viceversa) la pasa igual. Y eso es peligroso, no
  // sólo incompleto: con un componente NULL, la comparación de tuplas del
  // CHECK "no reprogramar a la misma celda" evalúa a NULL en vez de a FALSE,
  // y Postgres considera satisfecho un CHECK que da NULL — dejando pasar un
  // `reprogrammed` que en realidad apunta a su propia celda de origen. Exigir
  // que ambos vengan o ninguno cierra el destino a medias y, con eso, le
  // devuelve su fuerza a la comparación de tuplas.
  check("pdtp_execution_deviations_target_both_or_neither_check", sql`(${table.targetMonth} IS NULL) = (${table.targetWeek} IS NULL)`),
  // Reprogramar a la misma celda de origen no tiene sentido.
  check("pdtp_execution_deviations_target_not_same_cell_check", sql`${table.kind} <> 'reprogrammed' OR (${table.targetMonth}, ${table.targetWeek}) <> (${table.month}, ${table.week})`),
  check("pdtp_execution_deviations_target_month_check", sql`${table.targetMonth} IS NULL OR ${table.targetMonth} BETWEEN 1 AND 12`),
  check("pdtp_execution_deviations_target_week_check", sql`${table.targetWeek} IS NULL OR ${table.targetWeek} BETWEEN 1 AND 4`),
  check("pdtp_execution_deviations_withdrawn_check", sql`${table.status} <> 'withdrawn' OR (${table.withdrawnByUserId} IS NOT NULL AND ${table.withdrawnAt} IS NOT NULL AND length(trim(COALESCE(${table.withdrawReason}, ''))) >= 10)`),
])

/**
 * Cierre mensual del programa por faena (Fase 4, G4).
 *
 * Un cierre existe para una sola cosa: que meses después alguien pueda
 * regenerar **exactamente** el documento que se firmó, sin depender de lo que
 * la base viva diga hoy. Por eso `snapshot_json` no es una caché sino el
 * producto: el RE-36 completo, los indicadores, el reporte de gestión, los
 * desvíos y el avance por objetivo, congelados al corte del mes. El export
 * del cierre se renderiza desde esa foto, nunca reconsultando.
 *
 * `digest` es el sha256 del JSON canónico de la foto. No entra en la huella
 * firmada del programa (`content-digest.ts`): un cierre es un hecho
 * operacional posterior a la firma, igual que overrides y desvíos. Sirve para
 * responder una sola pregunta —"¿cambió algo del mes desde que se cerró?"—
 * recomputando la foto y comparando (`driftedSinceClose`), que es lo que
 * permite que la acreditación por integración siga entrando a un mes cerrado
 * sin mentir sobre lo que se distribuyó.
 *
 * `status = 'reopened'` conserva el snapshot: reabrir no borra la foto que ya
 * se distribuyó, sólo vuelve a permitir escrituras. Un cierre posterior
 * incrementa `version` y reemplaza la foto.
 */
export const pdtpPeriodClosures = pgTable("pdtp_period_closures", {
  id:                 text("id").primaryKey(),
  programId:          text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  /** `restrict`: un cierre es evidencia distribuida; borrar la faena que lo
   * originó lo dejaría sin sujeto. Las faenas se desactivan, no se borran. */
  worksiteId:         text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  year:               integer("year").notNull(),
  month:              integer("month").notNull(),
  status:             text("status").notNull().default("closed"),
  version:            integer("version").notNull().default(1),
  snapshotJson:       jsonb("snapshot_json").notNull(),
  digest:             text("digest").notNull(),
  closedByUserId:     text("closed_by_user_id").notNull().references(() => users.id),
  closedAt:           timestamp("closed_at", { withTimezone: true, mode: "string" }).notNull(),
  closeReason:        text("close_reason").notNull(),
  reopenedByUserId:   text("reopened_by_user_id").references(() => users.id),
  reopenedAt:         timestamp("reopened_at", { withTimezone: true, mode: "string" }),
  reopenReason:       text("reopen_reason"),
  /** Momento del último envío por notificación/correo, o NULL si nunca se
   * distribuyó. Reenviar lo actualiza; el `dedupeKey` por versión impide que
   * un reenvío duplique la notificación de quien ya la tiene. */
  distributedAt:      timestamp("distributed_at", { withTimezone: true, mode: "string" }),
  distributionJson:   jsonb("distribution_json").notNull().default([]),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_period_closures_period_unique").on(table.programId, table.worksiteId, table.year, table.month),
  index("pdtp_period_closures_worksite_period_idx").on(table.worksiteId, table.year, table.month),
  check("pdtp_period_closures_year_check", sql`${table.year} BETWEEN 2024 AND 2100`),
  check("pdtp_period_closures_month_check", sql`${table.month} BETWEEN 1 AND 12`),
  check("pdtp_period_closures_status_check", sql`${table.status} IN ('closed', 'reopened')`),
  check("pdtp_period_closures_version_check", sql`${table.version} >= 1`),
  // sha256 en hexadecimal: 64 caracteres. Un digest recortado o vacío haría
  // que `driftedSinceClose` comparara contra basura y siempre diera "cambió".
  check("pdtp_period_closures_digest_check", sql`length(${table.digest}) = 64`),
  check("pdtp_period_closures_close_reason_check", sql`length(trim(${table.closeReason})) >= 10`),
  // Mismo patrón que el retiro de un desvío: el estado terminal no existe sin
  // quién, cuándo y por qué.
  check("pdtp_period_closures_reopened_check", sql`${table.status} <> 'reopened' OR (${table.reopenedByUserId} IS NOT NULL AND ${table.reopenedAt} IS NOT NULL AND length(trim(COALESCE(${table.reopenReason}, ''))) >= 10)`),
])

/**
 * Libro durable de eventos de cumplimiento (Fase 2 de la plataforma de
 * cumplimiento, 2026-09-02).
 *
 * `accreditPdtpFromEvent` lanza si el programa no está activo o si falta el
 * mapeo, y cada conector se lo traga con `logger.error`: mientras el programa
 * está en `draft`, todo hecho operacional que ocurre se pierde sin rastro.
 * Este libro es lo que evita eso — cada intento de acreditación queda
 * registrado, se pueda o no completar en el momento, y un reconciliador puede
 * reprocesar los `pending`/`error` más tarde sin perder el hecho original.
 *
 * No sustituye a `pdtp_executions`: cuando la acreditación se logra, esta fila
 * queda enlazada a la ejecución que produjo (`execution_id`), pero el libro
 * existe incluso cuando la acreditación falla — que es justamente el caso que
 * `pdtp_executions` no puede representar.
 */
export const pdtpFulfillmentEvents = pgTable("pdtp_fulfillment_events", {
  id:              text("id").primaryKey(),
  sourceType:      text("source_type").notNull(),
  sourceId:        text("source_id").notNull(),
  eventType:       text("event_type").notNull(),
  /** Versión del contrato anual que resolvió el destino (ver
   *  `fulfillment-contract-2026.ts`). Sin esto, un contrato 2027 con otro mapa
   *  de actividades no podría distinguirse de un evento 2026 reprocesado. */
  sourceVersion:   text("source_version"),
  worksiteId:      text("worksite_id").notNull().references(() => worksites.id),
  occurredAt:      timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  quantity:        numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull().default(1),
  evidenceRef:     text("evidence_ref"),
  returnHref:      text("return_href"),
  idempotencyKey:  text("idempotency_key").notNull(),
  status:          text("status").notNull().default("pending"),
  programId:       text("program_id").references(() => pdtpPrograms.id, { onDelete: "set null" }),
  /** Usuario que originó una aprobación automática cuando el evento se
   * reconcilia después de que el programa queda activo. */
  autoApproveByUserId: text("auto_approve_by_user_id").references(() => users.id, { onDelete: "set null" }),
  /**
   * Números de actividad (`pdtp_activities.n`, no el id) que este evento
   * intenta acreditar — el mismo vocabulario que `AccreditationInput`. Un solo
   * hecho operacional puede acreditar más de una actividad (N°25 y N°26 juntas
   * desde un mismo reporte de uso diario), así que no hay una sola
   * `activity_id` que lo represente: sería falso para el caso compuesto y
   * arbitrario para elegir cuál de las dos.
   */
  activityNumbers: jsonb("activity_numbers").notNull().default([]),
  /** Año del cronograma fuente cuando el ítem no tiene mes/semana (por ejemplo,
   * una campaña anual). La fecha real del registro sigue conservándose en
   * `occurredAt`. */
  plannedYear:     integer("planned_year"),
  /** Posición del cronograma fuente cuando el hecho se marca después del mes
   * planificado. Así una corrección tardía sigue acreditando el período anual
   * que correspondía, sin falsear la fecha real de registro. */
  periodOverrideJson: jsonb("period_override_json").$type<{ year: number; month: number; week: number } | null>().default(null),
  /** Snapshot del `AccreditationResult`: qué se acreditó, qué se omitió y por
   *  qué. Diagnóstico para el reconciliador y para la compuerta 81/81. */
  resultJson:      jsonb("result_json").notNull().default({}),
  attempts:        integer("attempts").notNull().default(0),
  lastError:       text("last_error"),
  reconciledAt:    timestamp("reconciled_at", { withTimezone: true, mode: "string" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_fulfillment_events_idempotency_key_unique").on(table.idempotencyKey),
  index("pdtp_fulfillment_events_status_idx").on(table.status),
  index("pdtp_fulfillment_events_worksite_period_idx").on(table.worksiteId, table.occurredAt),
  index("pdtp_fulfillment_events_source_idx").on(table.sourceType, table.sourceId),
  check("pdtp_fulfillment_events_event_type_check", sql`${table.eventType} IN ('completed', 'revoked')`),
  check("pdtp_fulfillment_events_status_check", sql`${table.status} IN ('pending', 'accredited', 'rejected', 'revoked', 'error')`),
  check("pdtp_fulfillment_events_quantity_check", sql`${table.quantity} >= 0`),
  check("pdtp_fulfillment_events_attempts_check", sql`${table.attempts} >= 0`),
  check("pdtp_fulfillment_events_planned_year_check", sql`${table.plannedYear} IS NULL OR ${table.plannedYear} BETWEEN 2024 AND 2100`),
])

/**
 * Objetivos normalizados de un evento de cumplimiento. `activityNumbers` en
 * el evento queda como snapshot histórico durante la transición, pero la
 * identidad resoluble vive aquí.
 */
export const pdtpFulfillmentEventTargets = pgTable("pdtp_fulfillment_event_targets", {
  id:                  text("id").primaryKey(),
  eventId:             text("event_id").notNull(),
  catalogActivityId:   text("catalog_activity_id").notNull(),
  resolvedActivityId:  text("resolved_activity_id"),
  activityNumberSnapshot: integer("activity_number_snapshot"),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.eventId], foreignColumns: [pdtpFulfillmentEvents.id], name: "pdtp_event_target_event_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.catalogActivityId], foreignColumns: [pdtpCatalogActivities.id], name: "pdtp_event_target_catalog_activity_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.resolvedActivityId], foreignColumns: [pdtpActivities.id], name: "pdtp_event_target_annual_activity_fk" }).onDelete("set null"),
  uniqueIndex("pdtp_fulfillment_event_targets_identity_unique").on(table.eventId, table.catalogActivityId),
  index("pdtp_fulfillment_event_targets_catalog_idx").on(table.catalogActivityId),
  index("pdtp_fulfillment_event_targets_resolved_idx").on(table.resolvedActivityId),
  check("pdtp_fulfillment_event_targets_number_check", sql`${table.activityNumberSnapshot} IS NULL OR ${table.activityNumberSnapshot} >= 1`),
])

export const pdtpObligationReminders = pgTable("pdtp_obligation_reminders", {
  id:              text("id").primaryKey(),
  obligationId:    text("obligation_id").notNull().references(() => pdtpObligations.id, { onDelete: "cascade" }),
  recipientUserId: text("recipient_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  reminderWindow:  text("reminder_window").notNull(),
  status:          text("status").notNull().default("sent"),
  sentAt:          timestamp("sent_at", { withTimezone: true, mode: "string" }),
  errorMessage:    text("error_message"),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_obligation_reminders_dedupe_unique").on(table.obligationId, table.recipientUserId, table.reminderWindow),
  index("pdtp_obligation_reminders_status_idx").on(table.status, table.createdAt),
  check("pdtp_obligation_reminders_window_check", sql`${table.reminderWindow} IN ('due_7d', 'due_1d', 'overdue')`),
  check("pdtp_obligation_reminders_status_check", sql`${table.status} IN ('sent', 'failed')`),
])

export const pdtpChangeLog = pgTable("pdtp_change_log", {
  id:              text("id").primaryKey(),
  programId:       text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  version:         integer("version").notNull(),
  changedByUserId: text("changed_by_user_id").references(() => users.id),
  changedAt:       timestamp("changed_at", { withTimezone: true, mode: "string" }).notNull(),
  section:         text("section").notNull(),
  before:          jsonb("before"),
  after:           jsonb("after"),
  note:            text("note"),
}, (table) => [
  index("pdtp_change_log_program_version_idx").on(table.programId, table.version),
  check("pdtp_change_log_section_check", sql`length(${table.section}) > 0`),
])

export const pdtpSheets = pgTable("pdtp_sheets", {
  id:                text("id").primaryKey(),
  code:              text("code").notNull(),
  programId:         text("program_id").references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  label:             text("label").notNull(),
  area:              text("area").notNull(),
  defaultScopeRoles: jsonb("default_scope_roles").notNull(),
  isActive:          boolean("is_active").notNull().default(true),
}, (table) => [
  uniqueIndex("pdtp_sheets_program_code_unique").on(table.programId, table.code),
])

export const pdtpSheetActivities = pgTable("pdtp_sheet_activities", {
  id:           text("id").primaryKey(),
  sheetId:      text("sheet_id").notNull().references(() => pdtpSheets.id, { onDelete: "cascade" }),
  sheetCode:    text("sheet_code").notNull(),
  activityId:   text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  sheetRow:     integer("sheet_row").notNull(),
  displayOrder: integer("display_order").notNull(),
}, (table) => [
  uniqueIndex("pdtp_sheet_activities_sheet_activity_unique").on(table.sheetId, table.activityId),
  index("pdtp_sheet_activities_sheet_order_idx").on(table.sheetId, table.displayOrder),
])

export const pdtpActivityScheduleOverrides = pgTable("pdtp_activity_schedule_overrides", {
  id:              text("id").primaryKey(),
  activityId:      text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  worksiteId:      text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  year:            integer("year").notNull(),
  month:           integer("month").notNull(),
  week:            integer("week").notNull(),
  plannedQuantity: numeric("planned_quantity", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_schedule_overrides_activity_scope_period_unique").on(table.activityId, table.worksiteId, table.year, table.month, table.week),
  index("pdtp_schedule_overrides_worksite_year_month_idx").on(table.worksiteId, table.year, table.month),
  check("pdtp_schedule_overrides_month_check", sql`${table.month} BETWEEN 1 AND 12`),
  check("pdtp_schedule_overrides_week_check", sql`${table.week} BETWEEN 1 AND 4`),
  check("pdtp_schedule_overrides_quantity_check", sql`${table.plannedQuantity} >= 0`),
])

/* ── PDTP Activity Checklists (plantilla de checklist por actividad) ──────── */
// definitionJson reutiliza ChecklistDefinition de lib/sst/types.ts.
export const pdtpActivityChecklists = pgTable("pdtp_activity_checklists", {
  id:             text("id").primaryKey(),
  activityId:     text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  programId:      text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  version:        text("version").notNull().default("01"),
  label:          text("label").notNull(),
  definitionJson: jsonb("definition_json").notNull(),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_activity_checklists_activity_active_unique").on(table.activityId).where(sql`${table.isActive} = true`),
  index("pdtp_activity_checklists_program_idx").on(table.programId),
  check("pdtp_activity_checklists_version_check", sql`length(${table.version}) > 0`),
])

/**
 * Membresía de faenas de un programa. Sin filas para un `programId`, el
 * programa aplica a todas las faenas del scope del usuario (comportamiento
 * histórico, retrocompatible). Con filas, solo esas faenas lo ven — la
 * herencia es "todas las actividades menos sus exclusiones" (ver
 * `pdtpActivityWorksiteExclusions`), no una copia del programa por faena.
 */
export const pdtpProgramWorksites = pgTable("pdtp_program_worksites", {
  id:            text("id").primaryKey(),
  programId:     text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  worksiteId:    text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  isActive:      boolean("is_active").notNull().default(true),
  addedByUserId: text("added_by_user_id").references(() => users.id),
  addedAt:       timestamp("added_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_program_worksites_program_worksite_unique").on(table.programId, table.worksiteId),
  index("pdtp_program_worksites_worksite_idx").on(table.worksiteId),
])

/**
 * Excepción de herencia: una faena miembro del programa (o cualquier faena,
 * si el programa no declara membresía) no ve esta actividad puntual. No
 * reemplaza el override de meta por faena (`pdtpActivityScheduleOverrides`,
 * que solo cambia la cantidad planificada) — esto excluye la actividad
 * completa para esa faena.
 */
export const pdtpActivityWorksiteExclusions = pgTable("pdtp_activity_worksite_exclusions", {
  id:              text("id").primaryKey(),
  activityId:      text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  worksiteId:      text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  reason:          text("reason").notNull(),
  createdByUserId: text("created_by_user_id").references(() => users.id),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_activity_worksite_exclusions_activity_worksite_unique").on(table.activityId, table.worksiteId),
  index("pdtp_activity_worksite_exclusions_worksite_idx").on(table.worksiteId),
])

/* ── PDTP Activity Worksite Params (parámetros por faena: R1 sujetos, R2 cobertura) ── */
export const pdtpActivityWorksiteParams = pgTable("pdtp_activity_worksite_params", {
  id:                   text("id").primaryKey(),
  activityId:           text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  worksiteId:           text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  expectedSubjectCount: integer("expected_subject_count"),
  targetCoveragePercent: numeric("target_coverage_percent", { precision: 5, scale: 2, mode: "number" }),
  responsibleSlugs:     jsonb("responsible_slugs"),
  responsibleDisplay:   text("responsible_display"),
  responsibleReason:    text("responsible_reason"),
  updatedByUserId:      text("updated_by_user_id").references(() => users.id),
  createdAt:            timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("pdtp_activity_worksite_params_unique").on(table.activityId, table.worksiteId),
  index("pdtp_activity_worksite_params_worksite_idx").on(table.worksiteId),
  check("pdtp_activity_worksite_params_subject_count_check", sql`${table.expectedSubjectCount} IS NULL OR ${table.expectedSubjectCount} >= 0`),
  // El 0-100 lo imponía sólo Zod, y `setPdtpActivityWorksiteParams` escribe sin
  // pasar por ahí: un 900 % de meta habría bajado el umbral de acreditación a
  // un número imposible de alcanzar, callado.
  check("pdtp_activity_worksite_params_coverage_target_check", sql`${table.targetCoveragePercent} IS NULL OR (${table.targetCoveragePercent} > 0 AND ${table.targetCoveragePercent} <= 100)`),
  check("pdtp_activity_worksite_params_responsible_check", sql`${table.responsibleSlugs} IS NULL OR (
    jsonb_typeof(${table.responsibleSlugs}) = 'array'
    AND jsonb_array_length(${table.responsibleSlugs}) > 0
    AND length(trim(COALESCE(${table.responsibleDisplay}, ''))) > 0
    AND length(trim(COALESCE(${table.responsibleReason}, ''))) >= 10
  )`),
])

/* ── PDTP Asignación nominal por faena (Fase 5) ──────────────────────────── */
/**
 * Quién, con nombre y apellido, responde por una actividad del programa en una
 * faena concreta.
 *
 * El programa firmado dice el CARGO ("Jefe de terreno"), no la persona, y eso
 * es correcto: el documento sobrevive a la rotación. Pero la cola de pendientes
 * derivaba el dueño sólo del cargo, así que con dos jefes de terreno en la
 * misma faena la fila le aparecía a los dos y ninguno sabía si era suya. Esta
 * tabla es la capa de OPERACIÓN encima del documento: nombra a la persona sin
 * tocar el contenido.
 *
 * **No entra en la huella firmada** (`lib/services/pdtp/content-digest.ts`):
 * asignar una actividad a alguien no es un cambio de contenido y no debe abrir
 * una revisión v+1, igual que los overrides de meta y los desvíos por celda.
 *
 * **Vigencia por fecha, no por bandera.** Cuando alguien deja de ser el
 * responsable, la fila no se borra: se le pone `valid_until`. Quién respondía
 * por la actividad en la semana que el fiscalizador pregunta es exactamente lo
 * que un `DELETE` haría imposible de contestar. El índice único parcial cuida
 * que haya una sola asignación abierta por (actividad, faena, persona); varias
 * personas a la vez sí se permiten, que es el caso de los turnos.
 *
 * `roleId` es informativo: deja registrado con qué rol se ofreció a esa persona
 * como candidata. No manda sobre la visibilidad —esa la decide `userId`— y por
 * eso admite `SET NULL` si el rol se elimina.
 */
export const pdtpActivityWorksiteAssignees = pgTable("pdtp_activity_worksite_assignees", {
  id:              text("id").primaryKey(),
  // FK con nombre explícito: el que Drizzle derivaría
  // (`..._activity_id_pdtp_activities_id_fk`) mide 66 caracteres y Postgres lo
  // truncaría a 63 — `scripts/verify-migration-chain.mjs` lo rechaza.
  activityId:      text("activity_id").notNull(),
  worksiteId:      text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  // `restrict`: borrar una cuenta no puede borrar en silencio el registro de
  // quién era responsable. Una persona que se va se cierra por vigencia.
  userId:          text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  roleId:          text("role_id").references(() => roles.id, { onDelete: "set null" }),
  validFrom:       date("valid_from", { mode: "string" }).notNull(),
  validUntil:      date("valid_until", { mode: "string" }),
  note:            text("note"),
  createdByUserId: text("created_by_user_id").references(() => users.id),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  foreignKey({
    columns: [table.activityId],
    foreignColumns: [pdtpActivities.id],
    name: "pdtp_activity_worksite_assignees_activity_fk",
  }).onDelete("cascade"),
  // Una sola asignación ABIERTA por persona y celda actividad×faena. El
  // historial cerrado (`valid_until IS NOT NULL`) se acumula sin estorbar.
  uniqueIndex("pdtp_activity_worksite_assignees_open_unique")
    .on(table.activityId, table.worksiteId, table.userId)
    .where(sql`valid_until IS NULL`),
  // "Qué le toca a esta persona en esta faena" — la pregunta de /pendientes.
  index("pdtp_activity_worksite_assignees_worksite_user_idx").on(table.worksiteId, table.userId),
  // "Quién responde por esta actividad acá" — la pregunta de la planilla y del RE-36.
  index("pdtp_activity_worksite_assignees_activity_worksite_idx").on(table.activityId, table.worksiteId),
  check(
    "pdtp_activity_worksite_assignees_validity_check",
    sql`${table.validUntil} IS NULL OR ${table.validUntil} >= ${table.validFrom}`,
  ),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const pdtpProgramsRelations = relations(pdtpPrograms, ({ many, one }) => ({
  elaboratedByUser: one(users, { fields: [pdtpPrograms.elaboratedByUserId], references: [users.id] }),
  approvedByJdprUser: one(users, { fields: [pdtpPrograms.approvedByJdprUserId], references: [users.id] }),
  approvedByLegalUser: one(users, { fields: [pdtpPrograms.approvedByLegalUserId], references: [users.id] }),
  reviewStartedByUser: one(users, { fields: [pdtpPrograms.reviewStartedByUserId], references: [users.id] }),
  activatedByUser: one(users, { fields: [pdtpPrograms.activatedByUserId], references: [users.id] }),
  rejectedByUser: one(users, { fields: [pdtpPrograms.rejectedByUserId], references: [users.id] }),
  archivedByUser: one(users, { fields: [pdtpPrograms.archivedByUserId], references: [users.id] }),
  lastReopenedByUser: one(users, { fields: [pdtpPrograms.lastReopenedByUserId], references: [users.id] }),
  activities: many(pdtpActivities),
  objectives: many(pdtpObjectives),
  changeLog: many(pdtpChangeLog),
  sheets: many(pdtpSheets),
  approvalSteps: many(pdtpApprovalSteps),
  approvalDecisions: many(pdtpApprovalDecisions),
  documentHistory: many(pdtpDocumentHistory),
  roleLegendEntries: many(pdtpRoleLegendEntries),
  worksites: many(pdtpProgramWorksites),
  revisionDiffDecisions: many(pdtpRevisionDiffDecisions),
}))

export const pdtpProgramWorksitesRelations = relations(pdtpProgramWorksites, ({ one }) => ({
  program: one(pdtpPrograms, { fields: [pdtpProgramWorksites.programId], references: [pdtpPrograms.id] }),
  worksite: one(worksites, { fields: [pdtpProgramWorksites.worksiteId], references: [worksites.id] }),
  addedByUser: one(users, { fields: [pdtpProgramWorksites.addedByUserId], references: [users.id] }),
}))

export const pdtpActivityWorksiteAssigneesRelations = relations(pdtpActivityWorksiteAssignees, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpActivityWorksiteAssignees.activityId], references: [pdtpActivities.id] }),
  worksite: one(worksites, { fields: [pdtpActivityWorksiteAssignees.worksiteId], references: [worksites.id] }),
  user: one(users, { fields: [pdtpActivityWorksiteAssignees.userId], references: [users.id] }),
  role: one(roles, { fields: [pdtpActivityWorksiteAssignees.roleId], references: [roles.id] }),
}))

export const pdtpActivityWorksiteExclusionsRelations = relations(pdtpActivityWorksiteExclusions, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpActivityWorksiteExclusions.activityId], references: [pdtpActivities.id] }),
  worksite: one(worksites, { fields: [pdtpActivityWorksiteExclusions.worksiteId], references: [worksites.id] }),
  createdByUser: one(users, { fields: [pdtpActivityWorksiteExclusions.createdByUserId], references: [users.id] }),
}))

export const pdtpImportBatchesRelations = relations(pdtpImportBatches, ({ one, many }) => ({
  program: one(pdtpPrograms, { fields: [pdtpImportBatches.programId], references: [pdtpPrograms.id] }),
  documentHistory: many(pdtpDocumentHistory),
  roleLegendEntries: many(pdtpRoleLegendEntries),
}))

export const pdtpDocumentHistoryRelations = relations(pdtpDocumentHistory, ({ one }) => ({
  program: one(pdtpPrograms, { fields: [pdtpDocumentHistory.programId], references: [pdtpPrograms.id] }),
  linkedUser: one(users, { fields: [pdtpDocumentHistory.linkedUserId], references: [users.id], relationName: "pdtp_document_history_linked_user" }),
  reconciledByUser: one(users, { fields: [pdtpDocumentHistory.reconciledByUserId], references: [users.id], relationName: "pdtp_document_history_reconciled_by" }),
  sourceImportBatch: one(pdtpImportBatches, { fields: [pdtpDocumentHistory.sourceImportBatchId], references: [pdtpImportBatches.id] }),
}))

export const pdtpRoleLegendEntriesRelations = relations(pdtpRoleLegendEntries, ({ one }) => ({
  program: one(pdtpPrograms, { fields: [pdtpRoleLegendEntries.programId], references: [pdtpPrograms.id] }),
  sourceImportBatch: one(pdtpImportBatches, { fields: [pdtpRoleLegendEntries.sourceImportBatchId], references: [pdtpImportBatches.id] }),
}))

export const pdtpProgramTemplatesRelations = relations(pdtpProgramTemplates, ({ one, many }) => ({
  createdByUser: one(users, { fields: [pdtpProgramTemplates.createdByUserId], references: [users.id] }),
  versions: many(pdtpProgramTemplateVersions),
}))

export const pdtpProgramTemplateVersionsRelations = relations(pdtpProgramTemplateVersions, ({ one }) => ({
  template: one(pdtpProgramTemplates, { fields: [pdtpProgramTemplateVersions.templateId], references: [pdtpProgramTemplates.id] }),
  sourceProgram: one(pdtpPrograms, { fields: [pdtpProgramTemplateVersions.sourceProgramId], references: [pdtpPrograms.id] }),
  publishedByUser: one(users, { fields: [pdtpProgramTemplateVersions.publishedByUserId], references: [users.id] }),
}))

export const pdtpApprovalStepsRelations = relations(pdtpApprovalSteps, ({ one, many }) => ({
  program: one(pdtpPrograms, { fields: [pdtpApprovalSteps.programId], references: [pdtpPrograms.id] }),
  decisions: many(pdtpApprovalDecisions),
}))

export const pdtpApprovalDecisionsRelations = relations(pdtpApprovalDecisions, ({ one }) => ({
  program: one(pdtpPrograms, { fields: [pdtpApprovalDecisions.programId], references: [pdtpPrograms.id] }),
  step: one(pdtpApprovalSteps, { fields: [pdtpApprovalDecisions.stepId], references: [pdtpApprovalSteps.id] }),
  actor: one(users, { fields: [pdtpApprovalDecisions.actorUserId], references: [users.id] }),
}))

export const pdtpObjectivesRelations = relations(pdtpObjectives, ({ one, many }) => ({
  program: one(pdtpPrograms, { fields: [pdtpObjectives.programId], references: [pdtpPrograms.id] }),
  activities: many(pdtpActivities),
}))

export const pdtpActivitiesRelations = relations(pdtpActivities, ({ one, many }) => ({
  program: one(pdtpPrograms, { fields: [pdtpActivities.programId], references: [pdtpPrograms.id] }),
  objective: one(pdtpObjectives, { fields: [pdtpActivities.objectiveId], references: [pdtpObjectives.id] }),
  executionConfig: one(pdtpActivityExecutionConfigs, { fields: [pdtpActivities.id], references: [pdtpActivityExecutionConfigs.activityId] }),
  schedule: many(pdtpActivitySchedule),
  scheduledInstances: many(pdtpScheduledInstances),
  executions: many(pdtpExecutions),
  obligations: many(pdtpObligations),
  reminderRules: many(pdtpActivityReminderRules),
  sheetMemberships: many(pdtpSheetActivities),
  checklists: many(pdtpActivityChecklists),
  worksiteExclusions: many(pdtpActivityWorksiteExclusions),
  executorAssignments: many(pdtpActivityExecutorAssignments),
}))

export const pdtpActivityExecutionConfigsRelations = relations(pdtpActivityExecutionConfigs, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpActivityExecutionConfigs.activityId], references: [pdtpActivities.id] }),
  accreditationBinding: one(pdtpAccreditationBindings, { fields: [pdtpActivityExecutionConfigs.accreditationBindingId], references: [pdtpAccreditationBindings.id] }),
}))

export const pdtpScheduledInstancesRelations = relations(pdtpScheduledInstances, ({ one, many }) => ({
  program: one(pdtpPrograms, { fields: [pdtpScheduledInstances.programId], references: [pdtpPrograms.id] }),
  activity: one(pdtpActivities, { fields: [pdtpScheduledInstances.activityId], references: [pdtpActivities.id] }),
  worksite: one(worksites, { fields: [pdtpScheduledInstances.worksiteId], references: [worksites.id] }),
  responsibleUser: one(users, { fields: [pdtpScheduledInstances.responsibleUserId], references: [users.id] }),
  startedByUser: one(users, { fields: [pdtpScheduledInstances.startedByUserId], references: [users.id] }),
  completedByUser: one(users, { fields: [pdtpScheduledInstances.completedByUserId], references: [users.id] }),
  cancelledByUser: one(users, { fields: [pdtpScheduledInstances.cancelledByUserId], references: [users.id] }),
  execution: one(pdtpExecutions),
  reminderDeliveries: many(pdtpReminderDeliveries),
}))

export const pdtpActivityExecutorAssignmentsRelations = relations(pdtpActivityExecutorAssignments, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpActivityExecutorAssignments.activityId], references: [pdtpActivities.id] }),
  role: one(roles, { fields: [pdtpActivityExecutorAssignments.roleId], references: [roles.id] }),
}))

export const pdtpRevisionDiffDecisionsRelations = relations(pdtpRevisionDiffDecisions, ({ one }) => ({
  program: one(pdtpPrograms, { fields: [pdtpRevisionDiffDecisions.programId], references: [pdtpPrograms.id] }),
  baseTemplateVersion: one(pdtpProgramTemplateVersions, { fields: [pdtpRevisionDiffDecisions.baseTemplateVersionId], references: [pdtpProgramTemplateVersions.id] }),
  decidedByUser: one(users, { fields: [pdtpRevisionDiffDecisions.decidedByUserId], references: [users.id] }),
}))

export const pdtpActivityScheduleRelations = relations(pdtpActivitySchedule, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpActivitySchedule.activityId], references: [pdtpActivities.id] }),
}))

export const pdtpExecutionsRelations = relations(pdtpExecutions, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpExecutions.activityId], references: [pdtpActivities.id] }),
  worksite: one(worksites, { fields: [pdtpExecutions.worksiteId], references: [worksites.id] }),
  obligation: one(pdtpObligations, { fields: [pdtpExecutions.obligationId], references: [pdtpObligations.id] }),
  scheduledInstance: one(pdtpScheduledInstances, { fields: [pdtpExecutions.scheduledInstanceId], references: [pdtpScheduledInstances.id] }),
  executedByUser: one(users, { fields: [pdtpExecutions.executedByUserId], references: [users.id] }),
  approvedByUser: one(users, { fields: [pdtpExecutions.approvedByUserId], references: [users.id] }),
}))

export const pdtpActivityReminderRulesRelations = relations(pdtpActivityReminderRules, ({ one, many }) => ({
  activity: one(pdtpActivities, { fields: [pdtpActivityReminderRules.activityId], references: [pdtpActivities.id] }),
  recipientUser: one(users, { fields: [pdtpActivityReminderRules.recipientUserId], references: [users.id] }),
  deliveries: many(pdtpReminderDeliveries),
}))

export const pdtpReminderDeliveriesRelations = relations(pdtpReminderDeliveries, ({ one }) => ({
  scheduledInstance: one(pdtpScheduledInstances, { fields: [pdtpReminderDeliveries.scheduledInstanceId], references: [pdtpScheduledInstances.id] }),
  reminderRule: one(pdtpActivityReminderRules, { fields: [pdtpReminderDeliveries.reminderRuleId], references: [pdtpActivityReminderRules.id] }),
  recipientUser: one(users, { fields: [pdtpReminderDeliveries.recipientUserId], references: [users.id] }),
}))

export const pdtpTriggerEventsRelations = relations(pdtpTriggerEvents, ({ one }) => ({
  worksite: one(worksites, { fields: [pdtpTriggerEvents.worksiteId], references: [worksites.id] }),
  obligation: one(pdtpObligations, { fields: [pdtpTriggerEvents.obligationId], references: [pdtpObligations.id] }),
}))

export const pdtpExecutionDeviationsRelations = relations(pdtpExecutionDeviations, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpExecutionDeviations.activityId], references: [pdtpActivities.id] }),
  worksite: one(worksites, { fields: [pdtpExecutionDeviations.worksiteId], references: [worksites.id] }),
  createdByUser: one(users, { fields: [pdtpExecutionDeviations.createdByUserId], references: [users.id] }),
  withdrawnByUser: one(users, { fields: [pdtpExecutionDeviations.withdrawnByUserId], references: [users.id] }),
}))

export const pdtpPeriodClosuresRelations = relations(pdtpPeriodClosures, ({ one }) => ({
  program: one(pdtpPrograms, { fields: [pdtpPeriodClosures.programId], references: [pdtpPrograms.id] }),
  worksite: one(worksites, { fields: [pdtpPeriodClosures.worksiteId], references: [worksites.id] }),
  closedByUser: one(users, { fields: [pdtpPeriodClosures.closedByUserId], references: [users.id] }),
  reopenedByUser: one(users, { fields: [pdtpPeriodClosures.reopenedByUserId], references: [users.id] }),
}))

export const pdtpFulfillmentEventsRelations = relations(pdtpFulfillmentEvents, ({ one }) => ({
  worksite: one(worksites, { fields: [pdtpFulfillmentEvents.worksiteId], references: [worksites.id] }),
  program: one(pdtpPrograms, { fields: [pdtpFulfillmentEvents.programId], references: [pdtpPrograms.id] }),
}))

export const pdtpObligationsRelations = relations(pdtpObligations, ({ one, many }) => ({
  program: one(pdtpPrograms, { fields: [pdtpObligations.programId], references: [pdtpPrograms.id] }),
  activity: one(pdtpActivities, { fields: [pdtpObligations.activityId], references: [pdtpActivities.id] }),
  worksite: one(worksites, { fields: [pdtpObligations.worksiteId], references: [worksites.id] }),
  createdByUser: one(users, { fields: [pdtpObligations.createdByUserId], references: [users.id] }),
  cancelledByUser: one(users, { fields: [pdtpObligations.cancelledByUserId], references: [users.id] }),
  execution: one(pdtpExecutions),
  reminders: many(pdtpObligationReminders),
}))

export const pdtpObligationRemindersRelations = relations(pdtpObligationReminders, ({ one }) => ({
  obligation: one(pdtpObligations, { fields: [pdtpObligationReminders.obligationId], references: [pdtpObligations.id] }),
  recipientUser: one(users, { fields: [pdtpObligationReminders.recipientUserId], references: [users.id] }),
}))

export const pdtpChangeLogRelations = relations(pdtpChangeLog, ({ one }) => ({
  program: one(pdtpPrograms, { fields: [pdtpChangeLog.programId], references: [pdtpPrograms.id] }),
  changedByUser: one(users, { fields: [pdtpChangeLog.changedByUserId], references: [users.id] }),
}))

export const pdtpSheetsRelations = relations(pdtpSheets, ({ many, one }) => ({
  program: one(pdtpPrograms, { fields: [pdtpSheets.programId], references: [pdtpPrograms.id] }),
  activities: many(pdtpSheetActivities),
}))

export const pdtpSheetActivitiesRelations = relations(pdtpSheetActivities, ({ one }) => ({
  sheet: one(pdtpSheets, { fields: [pdtpSheetActivities.sheetId], references: [pdtpSheets.id] }),
  activity: one(pdtpActivities, { fields: [pdtpSheetActivities.activityId], references: [pdtpActivities.id] }),
}))

export const pdtpActivityScheduleOverridesRelations = relations(pdtpActivityScheduleOverrides, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpActivityScheduleOverrides.activityId], references: [pdtpActivities.id] }),
  worksite: one(worksites, { fields: [pdtpActivityScheduleOverrides.worksiteId], references: [worksites.id] }),
  updatedByUser: one(users, { fields: [pdtpActivityScheduleOverrides.updatedByUserId], references: [users.id] }),
}))

export const pdtpActivityChecklistsRelations = relations(pdtpActivityChecklists, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpActivityChecklists.activityId], references: [pdtpActivities.id] }),
  program: one(pdtpPrograms, { fields: [pdtpActivityChecklists.programId], references: [pdtpPrograms.id] }),
}))


/* ── Relations (extiende pdtpExecutions y pdtpActivities con las nuevas tablas) ─ */

/* ── Types ───────────────────────────────────────────────────────────────── */
export type PdtpProgram = typeof pdtpPrograms.$inferSelect
export type NewPdtpProgram = typeof pdtpPrograms.$inferInsert
export type PdtpActivityExecutorAssignment = typeof pdtpActivityExecutorAssignments.$inferSelect
export type NewPdtpActivityExecutorAssignment = typeof pdtpActivityExecutorAssignments.$inferInsert
export type PdtpRevisionDiffDecision = typeof pdtpRevisionDiffDecisions.$inferSelect
export type NewPdtpRevisionDiffDecision = typeof pdtpRevisionDiffDecisions.$inferInsert
export type PdtpProgramTemplate = typeof pdtpProgramTemplates.$inferSelect
export type NewPdtpProgramTemplate = typeof pdtpProgramTemplates.$inferInsert
export type PdtpProgramTemplateVersion = typeof pdtpProgramTemplateVersions.$inferSelect
export type NewPdtpProgramTemplateVersion = typeof pdtpProgramTemplateVersions.$inferInsert
export type PdtpImportBatch = typeof pdtpImportBatches.$inferSelect
export type NewPdtpImportBatch = typeof pdtpImportBatches.$inferInsert
export type PdtpImportRow = typeof pdtpImportRows.$inferSelect
export type NewPdtpImportRow = typeof pdtpImportRows.$inferInsert
export type PdtpDocumentHistoryEntry = typeof pdtpDocumentHistory.$inferSelect
export type NewPdtpDocumentHistoryEntry = typeof pdtpDocumentHistory.$inferInsert
export type PdtpRoleLegendEntry = typeof pdtpRoleLegendEntries.$inferSelect
export type NewPdtpRoleLegendEntry = typeof pdtpRoleLegendEntries.$inferInsert
export type PdtpResponsibleCatalog = typeof pdtpResponsibleCatalog.$inferSelect
export type NewPdtpResponsibleCatalog = typeof pdtpResponsibleCatalog.$inferInsert
export type PdtpObjective = typeof pdtpObjectives.$inferSelect
export type NewPdtpObjective = typeof pdtpObjectives.$inferInsert
export type PdtpActivity = typeof pdtpActivities.$inferSelect
export type NewPdtpActivity = typeof pdtpActivities.$inferInsert
export type PdtpActivityExecutionConfig = typeof pdtpActivityExecutionConfigs.$inferSelect
export type NewPdtpActivityExecutionConfig = typeof pdtpActivityExecutionConfigs.$inferInsert
export type PdtpActivitySchedule = typeof pdtpActivitySchedule.$inferSelect
export type NewPdtpActivitySchedule = typeof pdtpActivitySchedule.$inferInsert
export type PdtpScheduledInstance = typeof pdtpScheduledInstances.$inferSelect
export type NewPdtpScheduledInstance = typeof pdtpScheduledInstances.$inferInsert
export type PdtpExecution = typeof pdtpExecutions.$inferSelect
export type NewPdtpExecution = typeof pdtpExecutions.$inferInsert
export type PdtpExecutionDeviation = typeof pdtpExecutionDeviations.$inferSelect
export type NewPdtpExecutionDeviation = typeof pdtpExecutionDeviations.$inferInsert
export type PdtpPeriodClosure = typeof pdtpPeriodClosures.$inferSelect
export type NewPdtpPeriodClosure = typeof pdtpPeriodClosures.$inferInsert
export type PdtpObligation = typeof pdtpObligations.$inferSelect
export type NewPdtpObligation = typeof pdtpObligations.$inferInsert
export type PdtpObligationReminder = typeof pdtpObligationReminders.$inferSelect
export type NewPdtpObligationReminder = typeof pdtpObligationReminders.$inferInsert
export type PdtpActivityReminderRule = typeof pdtpActivityReminderRules.$inferSelect
export type NewPdtpActivityReminderRule = typeof pdtpActivityReminderRules.$inferInsert
export type PdtpReminderDelivery = typeof pdtpReminderDeliveries.$inferSelect
export type NewPdtpReminderDelivery = typeof pdtpReminderDeliveries.$inferInsert
export type PdtpTriggerEvent = typeof pdtpTriggerEvents.$inferSelect
export type NewPdtpTriggerEvent = typeof pdtpTriggerEvents.$inferInsert
export type PdtpChangeLog = typeof pdtpChangeLog.$inferSelect
export type NewPdtpChangeLog = typeof pdtpChangeLog.$inferInsert
export type PdtpSheet = typeof pdtpSheets.$inferSelect
export type NewPdtpSheet = typeof pdtpSheets.$inferInsert
export type PdtpSheetActivity = typeof pdtpSheetActivities.$inferSelect
export type NewPdtpSheetActivity = typeof pdtpSheetActivities.$inferInsert
export type PdtpActivityScheduleOverride = typeof pdtpActivityScheduleOverrides.$inferSelect
export type NewPdtpActivityScheduleOverride = typeof pdtpActivityScheduleOverrides.$inferInsert
export type PdtpProgramWorksite = typeof pdtpProgramWorksites.$inferSelect
export type NewPdtpProgramWorksite = typeof pdtpProgramWorksites.$inferInsert
export type PdtpActivityWorksiteAssignee = typeof pdtpActivityWorksiteAssignees.$inferSelect
export type NewPdtpActivityWorksiteAssignee = typeof pdtpActivityWorksiteAssignees.$inferInsert
export type PdtpActivityWorksiteExclusion = typeof pdtpActivityWorksiteExclusions.$inferSelect
export type NewPdtpActivityWorksiteExclusion = typeof pdtpActivityWorksiteExclusions.$inferInsert

export type PdtpActivityChecklist = typeof pdtpActivityChecklists.$inferSelect
export type NewPdtpActivityChecklist = typeof pdtpActivityChecklists.$inferInsert

/* ── Enums de dominio PDTP Checklist/Plan de acción ───────────────────────── */
export type PdtpChecklistStatus = "pendiente" | "en_proceso" | "completado"
export type PdtpActionEstado =
  | "pendiente"
  | "en_proceso"
  | "completado"
  | "verificado"
  | "reabierto"
export type PdtpActionPrioridad = "alta" | "media" | "baja"
export type PdtpActionOrigen = "checklist_item" | "manual"

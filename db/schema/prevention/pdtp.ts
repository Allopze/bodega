import { relations, sql } from "drizzle-orm"
import { boolean, check, date, index, integer, jsonb, numeric, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"
import { preventionCapaActions } from "./capa"

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
  uniqueIndex("pdtp_programs_year_version_unique").on(table.year, table.version),
  index("pdtp_programs_status_idx").on(table.status),
  check("pdtp_programs_status_check", sql`${table.status} IN ('draft', 'in_review', 'rejected', 'active', 'closed', 'archived')`),
  check("pdtp_programs_creation_mode_check", sql`${table.creationMode} IN ('blank', 'program_copy', 'template', 'xlsx_import')`),
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
  kind:        text("kind").notNull(),
  notes:       text("notes"),
  isActive:    boolean("is_active").notNull().default(true),
}, (table) => [
  uniqueIndex("pdtp_responsible_catalog_display_unique").on(table.displayName),
])

export const pdtpActivities = pgTable("pdtp_activities", {
  id:                 text("id").primaryKey(),
  programId:          text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  n:                  integer("n").notNull(),
  objectiveOrder:     integer("objective_order").notNull(),
  objective:          text("objective").notNull(),
  activity:           text("activity").notNull(),
  program:            text("program").notNull(),
  responsibleSlugs:   jsonb("responsible_slugs").notNull(),
  responsibleDisplay: text("responsible_display").notNull(),
  audienceRoles:       jsonb("audience_roles").notNull().default([]),
  scheduleMode:        text("schedule_mode").notNull().default("scheduled"),
  scheduleClassificationStatus: text("schedule_classification_status").notNull().default("confirmed"),
  recurrenceRule:      jsonb("recurrence_rule"),
  triggerType:         text("trigger_type"),
  triggerDescription:  text("trigger_description"),
  dueDays:             integer("due_days"),
  evidenceRequirement: text("evidence_requirement"),
  indicatorMode:       text("indicator_mode").notNull().default("planned_vs_completed"),
  targetValue:         numeric("target_value", { precision: 10, scale: 2, mode: "number" }),
  targetUnit:          text("target_unit"),
  sourceSheetRow:     integer("source_sheet_row").notNull(),
  notes:              text("notes"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_activities_program_n_unique").on(table.programId, table.n),
  index("pdtp_activities_program_objective_idx").on(table.programId, table.objectiveOrder),
  check("pdtp_activities_n_check", sql`${table.n} >= 1`),
  check("pdtp_activities_objective_order_check", sql`${table.objectiveOrder} >= 1`),
  check("pdtp_activities_schedule_mode_check", sql`${table.scheduleMode} IN ('scheduled', 'on_demand', 'triggered')`),
  check("pdtp_activities_schedule_classification_check", sql`${table.scheduleClassificationStatus} IN ('confirmed', 'needs_review')`),
  check("pdtp_activities_due_days_check", sql`${table.dueDays} IS NULL OR ${table.dueDays} >= 0`),
  check("pdtp_activities_indicator_mode_check", sql`${table.indicatorMode} IN ('planned_vs_completed', 'closed_on_time', 'completed_count', 'not_applicable')`),
  check("pdtp_activities_target_value_check", sql`${table.targetValue} IS NULL OR ${table.targetValue} >= 0`),
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
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_executions_activity_scope_period_unique").on(table.activityId, table.worksiteId, table.year, table.month, table.week).where(sql`${table.obligationId} IS NULL`),
  uniqueIndex("pdtp_executions_obligation_unique").on(table.obligationId),
  index("pdtp_executions_worksite_period_idx").on(table.worksiteId, table.year, table.month),
  index("pdtp_executions_status_idx").on(table.status),
  uniqueIndex("pdtp_executions_idempotency_key_unique").on(table.idempotencyKey),
  index("pdtp_executions_import_batch_idx").on(table.importBatchId),
  check("pdtp_executions_status_check", sql`${table.status} IN ('draft', 'submitted', 'approved', 'rejected')`),
  check("pdtp_executions_month_check", sql`${table.month} BETWEEN 1 AND 12`),
  check("pdtp_executions_week_check", sql`${table.week} BETWEEN 1 AND 4`),
  check("pdtp_executions_quantity_check", sql`${table.executedQuantity} >= 0`),
  check("pdtp_executions_origin_check", sql`${table.origin} IN ('manual', 'xlsx_import', 'integration')`),
  check("pdtp_executions_evidence_status_check", sql`${table.evidenceStatus} IN ('pending', 'provided', 'not_required', 'migrated_without_attachment')`),
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

/* ── PDTP Execution Checklists (instancia llenada por ejecución) ──────────── */
/**
 * Multi-sujeto (PLAN_INTEGRACION §4): una ejecución puede sostener N instancias
 * de checklist, una por sujeto (extintor, equipo, trabajador…). La instancia
 * única de faena (patrón B) usa subjectType=null y subjectId=''. `subjectId`
 * NO NULL evita el problema de "NULLs distintos" en el índice único
 * (executionId, subjectId) y permite coexistir con datos pre-migración.
 */
export const pdtpExecutionChecklists = pgTable("pdtp_execution_checklists", {
  id:                     text("id").primaryKey(),
  executionId:            text("execution_id").notNull().references(() => pdtpExecutions.id, { onDelete: "cascade" }),
  checklistId:            text("checklist_id").references(() => pdtpActivityChecklists.id, { onDelete: "set null" }),
  definitionSnapshotJson: jsonb("definition_snapshot_json").notNull(),
  overallStatus:          text("overall_status").notNull().default("pendiente"),
  porcentajeCumplimiento: real("porcentaje_cumplimiento"),
  completedByUserId:      text("completed_by_user_id").references(() => users.id),
  completedAt:            timestamp("completed_at", { withTimezone: true, mode: "string" }),
  // Sujeto multi-instancia: 'equipo' | 'trabajador' | 'contenedor' | 'extintor' | 'carro' | null
  subjectType:            text("subject_type"),
  // fuelVehicles.id / workers.id / '' (instancia de faena única). NOT NULL DEFAULT ''.
  subjectId:              text("subject_id").notNull().default(""),
  // Denormalizado para mostrar/exportar: patente, nombre, "Extintor #7 / acopio".
  subjectLabel:           text("subject_label"),
  createdAt:              timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:              timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  // Una instancia por (ejecución, sujeto). subjectId='' → instancia única de faena.
  uniqueIndex("pdtp_execution_checklists_execution_subject_unique").on(table.executionId, table.subjectId),
  check("pdtp_execution_checklists_status_check", sql`${table.overallStatus} IN ('pendiente', 'en_proceso', 'completado')`),
])

/* ── PDTP Execution Checklist Responses (1 fila por ítem) ────────────────── */
export const pdtpExecutionChecklistResponses = pgTable("pdtp_execution_checklist_responses", {
  id:                  text("id").primaryKey(),
  checklistInstanceId: text("checklist_instance_id").notNull().references(() => pdtpExecutionChecklists.id, { onDelete: "cascade" }),
  seccionId:           text("seccion_id").notNull(),
  itemId:              text("item_id").notNull(),
  estado:              text("estado"),
  observacion:         text("observacion"),
  accionCorrectiva:    text("accion_correctiva"),
  respondedByUserId:   text("responded_by_user_id").references(() => users.id),
  respondedAt:         timestamp("responded_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  uniqueIndex("pdtp_exec_responses_instance_section_item_unique").on(table.checklistInstanceId, table.seccionId, table.itemId),
])

/* ── PDTP Action Plan (plan de acción correctivo por ejecución) ───────────── */
export const pdtpActionPlan = pgTable("pdtp_action_plan", {
  id:                 text("id").primaryKey(),
  executionId:        text("execution_id").notNull().references(() => pdtpExecutions.id, { onDelete: "cascade" }),
  capaActionId:       text("capa_action_id").references(() => preventionCapaActions.id, { onDelete: "restrict" }),
  n:                  integer("n").notNull(),
  origen:             text("origen").notNull().default("manual"),
  seccionId:          text("seccion_id"),
  itemId:             text("item_id"),
  hallazgo:           text("hallazgo").notNull(),
  accion:             text("accion").notNull(),
  responsableRole:    text("responsable_role").notNull(),
  responsable:        text("responsable").notNull(),
  responsableUserId:  text("responsable_user_id").references(() => users.id),
  plazo:              text("plazo").notNull(),
  prioridad:          text("prioridad").notNull().default("media"),
  estado:             text("estado").notNull().default("pendiente"),
  createdByUserId:    text("created_by_user_id").notNull().references(() => users.id),
  closedAt:           timestamp("closed_at", { withTimezone: true, mode: "string" }),
  verifiedByUserId:   text("verified_by_user_id").references(() => users.id),
  verifiedAt:         timestamp("verified_at", { withTimezone: true, mode: "string" }),
  rejectionReason:    text("rejection_reason"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_action_plan_execution_n_unique").on(table.executionId, table.n),
  uniqueIndex("pdtp_action_plan_capa_unique").on(table.capaActionId),
  index("pdtp_action_plan_execution_idx").on(table.executionId),
  index("pdtp_action_plan_estado_idx").on(table.estado),
  index("pdtp_action_plan_plazo_idx").on(table.plazo),
  check("pdtp_action_plan_origen_check", sql`${table.origen} IN ('checklist_item', 'manual')`),
  check("pdtp_action_plan_prioridad_check", sql`${table.prioridad} IN ('alta', 'media', 'baja')`),
  check("pdtp_action_plan_estado_check", sql`${table.estado} IN ('pendiente', 'en_proceso', 'completado', 'verificado', 'reabierto', 'cancelado')`),
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
  check("pdtp_activity_worksite_exclusions_reason_check", sql`length(trim(${table.reason})) >= 10`),
])

/* ── PDTP Action Plan Followups (bitácora de seguimiento) ────────────────── */
export const pdtpActionPlanFollowups = pgTable("pdtp_action_plan_followups", {
  id:               text("id").primaryKey(),
  actionPlanItemId: text("action_plan_item_id").notNull().references(() => pdtpActionPlan.id, { onDelete: "cascade" }),
  fecha:            text("fecha").notNull(),
  estadoAnterior:   text("estado_anterior"),
  estadoNuevo:      text("estado_nuevo").notNull(),
  observacion:      text("observacion"),
  evidenciaUrl:     text("evidencia_url"),
  evidenciaPhotos:  jsonb("evidencia_photos").notNull().default([]),
  updatedByUserId:  text("updated_by_user_id").notNull().references(() => users.id),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("pdtp_action_plan_followups_item_fecha_idx").on(table.actionPlanItemId, table.fecha),
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
  changeLog: many(pdtpChangeLog),
  sheets: many(pdtpSheets),
  approvalSteps: many(pdtpApprovalSteps),
  approvalDecisions: many(pdtpApprovalDecisions),
  documentHistory: many(pdtpDocumentHistory),
  roleLegendEntries: many(pdtpRoleLegendEntries),
  worksites: many(pdtpProgramWorksites),
}))

export const pdtpProgramWorksitesRelations = relations(pdtpProgramWorksites, ({ one }) => ({
  program: one(pdtpPrograms, { fields: [pdtpProgramWorksites.programId], references: [pdtpPrograms.id] }),
  worksite: one(worksites, { fields: [pdtpProgramWorksites.worksiteId], references: [worksites.id] }),
  addedByUser: one(users, { fields: [pdtpProgramWorksites.addedByUserId], references: [users.id] }),
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

export const pdtpActivitiesRelations = relations(pdtpActivities, ({ one, many }) => ({
  program: one(pdtpPrograms, { fields: [pdtpActivities.programId], references: [pdtpPrograms.id] }),
  schedule: many(pdtpActivitySchedule),
  executions: many(pdtpExecutions),
  obligations: many(pdtpObligations),
  sheetMemberships: many(pdtpSheetActivities),
  checklists: many(pdtpActivityChecklists),
  worksiteExclusions: many(pdtpActivityWorksiteExclusions),
}))

export const pdtpActivityScheduleRelations = relations(pdtpActivitySchedule, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpActivitySchedule.activityId], references: [pdtpActivities.id] }),
}))

export const pdtpExecutionsRelations = relations(pdtpExecutions, ({ one, many }) => ({
  activity: one(pdtpActivities, { fields: [pdtpExecutions.activityId], references: [pdtpActivities.id] }),
  worksite: one(worksites, { fields: [pdtpExecutions.worksiteId], references: [worksites.id] }),
  obligation: one(pdtpObligations, { fields: [pdtpExecutions.obligationId], references: [pdtpObligations.id] }),
  executedByUser: one(users, { fields: [pdtpExecutions.executedByUserId], references: [users.id] }),
  approvedByUser: one(users, { fields: [pdtpExecutions.approvedByUserId], references: [users.id] }),
  checklistInstance: one(pdtpExecutionChecklists),
  actionPlan: many(pdtpActionPlan),
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

export const pdtpActivityChecklistsRelations = relations(pdtpActivityChecklists, ({ one, many }) => ({
  activity: one(pdtpActivities, { fields: [pdtpActivityChecklists.activityId], references: [pdtpActivities.id] }),
  program: one(pdtpPrograms, { fields: [pdtpActivityChecklists.programId], references: [pdtpPrograms.id] }),
  executionInstances: many(pdtpExecutionChecklists),
}))

export const pdtpExecutionChecklistsRelations = relations(pdtpExecutionChecklists, ({ one, many }) => ({
  execution: one(pdtpExecutions, { fields: [pdtpExecutionChecklists.executionId], references: [pdtpExecutions.id] }),
  checklist: one(pdtpActivityChecklists, { fields: [pdtpExecutionChecklists.checklistId], references: [pdtpActivityChecklists.id] }),
  completedByUser: one(users, { fields: [pdtpExecutionChecklists.completedByUserId], references: [users.id] }),
  responses: many(pdtpExecutionChecklistResponses),
}))

export const pdtpExecutionChecklistResponsesRelations = relations(pdtpExecutionChecklistResponses, ({ one }) => ({
  checklistInstance: one(pdtpExecutionChecklists, { fields: [pdtpExecutionChecklistResponses.checklistInstanceId], references: [pdtpExecutionChecklists.id] }),
  respondedByUser: one(users, { fields: [pdtpExecutionChecklistResponses.respondedByUserId], references: [users.id] }),
}))

export const pdtpActionPlanRelations = relations(pdtpActionPlan, ({ one, many }) => ({
  execution: one(pdtpExecutions, { fields: [pdtpActionPlan.executionId], references: [pdtpExecutions.id] }),
  responsableUser: one(users, { fields: [pdtpActionPlan.responsableUserId], references: [users.id] }),
  createdByUser: one(users, { fields: [pdtpActionPlan.createdByUserId], references: [users.id] }),
  verifiedByUser: one(users, { fields: [pdtpActionPlan.verifiedByUserId], references: [users.id] }),
  followups: many(pdtpActionPlanFollowups),
}))

export const pdtpActionPlanFollowupsRelations = relations(pdtpActionPlanFollowups, ({ one }) => ({
  actionPlanItem: one(pdtpActionPlan, { fields: [pdtpActionPlanFollowups.actionPlanItemId], references: [pdtpActionPlan.id] }),
  updatedByUser: one(users, { fields: [pdtpActionPlanFollowups.updatedByUserId], references: [users.id] }),
}))

/* ── Relations (extiende pdtpExecutions y pdtpActivities con las nuevas tablas) ─ */

/* ── Types ───────────────────────────────────────────────────────────────── */
export type PdtpProgram = typeof pdtpPrograms.$inferSelect
export type NewPdtpProgram = typeof pdtpPrograms.$inferInsert
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
export type PdtpActivity = typeof pdtpActivities.$inferSelect
export type NewPdtpActivity = typeof pdtpActivities.$inferInsert
export type PdtpActivitySchedule = typeof pdtpActivitySchedule.$inferSelect
export type NewPdtpActivitySchedule = typeof pdtpActivitySchedule.$inferInsert
export type PdtpExecution = typeof pdtpExecutions.$inferSelect
export type NewPdtpExecution = typeof pdtpExecutions.$inferInsert
export type PdtpObligation = typeof pdtpObligations.$inferSelect
export type NewPdtpObligation = typeof pdtpObligations.$inferInsert
export type PdtpObligationReminder = typeof pdtpObligationReminders.$inferSelect
export type NewPdtpObligationReminder = typeof pdtpObligationReminders.$inferInsert
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
export type PdtpActivityWorksiteExclusion = typeof pdtpActivityWorksiteExclusions.$inferSelect
export type NewPdtpActivityWorksiteExclusion = typeof pdtpActivityWorksiteExclusions.$inferInsert

export type PdtpActivityChecklist = typeof pdtpActivityChecklists.$inferSelect
export type NewPdtpActivityChecklist = typeof pdtpActivityChecklists.$inferInsert
export type PdtpExecutionChecklist = typeof pdtpExecutionChecklists.$inferSelect
export type NewPdtpExecutionChecklist = typeof pdtpExecutionChecklists.$inferInsert
export type PdtpExecutionChecklistResponse = typeof pdtpExecutionChecklistResponses.$inferSelect
export type NewPdtpExecutionChecklistResponse = typeof pdtpExecutionChecklistResponses.$inferInsert
export type PdtpActionPlanItem = typeof pdtpActionPlan.$inferSelect
export type NewPdtpActionPlanItem = typeof pdtpActionPlan.$inferInsert
export type PdtpActionPlanFollowup = typeof pdtpActionPlanFollowups.$inferSelect
export type NewPdtpActionPlanFollowup = typeof pdtpActionPlanFollowups.$inferInsert

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

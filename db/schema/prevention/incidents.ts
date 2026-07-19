import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { users } from "../users"
import { workers, worksites } from "../worksites"

export const preventionIncidents = pgTable("prevention_incidents", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  clientSubmissionId: text("client_submission_id").notNull().unique(),
  sftiExternalId: text("sfti_external_id"),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  companyName: text("company_name").notNull(),
  companyTaxId: text("company_tax_id"),
  eventType: text("event_type").notNull(),
  status: text("status").notNull().default("reported"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  knownAt: timestamp("known_at", { withTimezone: true, mode: "string" }).notNull(),
  location: text("location").notNull(),
  initialNarrative: text("initial_narrative").notNull(),
  reportedByUserId: text("reported_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  processName: text("process_name"),
  taskName: text("task_name"),
  shiftName: text("shift_name"),
  vehicleReference: text("vehicle_reference"),
  equipmentReference: text("equipment_reference"),
  wasteReference: text("waste_reference"),
  substanceReference: text("substance_reference"),
  actualSeverity: text("actual_severity").notNull().default("none"),
  potentialSeverity: text("potential_severity").notNull().default("low"),
  immediateMeasures: text("immediate_measures"),
  operationsSuspended: boolean("operations_suspended").notNull().default(false),
  evacuated: boolean("evacuated").notNull().default(false),
  isFatalOrSerious: boolean("is_fatal_or_serious").notNull().default(false),
  source: text("source").notNull().default("platform"),
  importRowId: text("import_row_id"),
  version: integer("version").notNull().default(1),
  triagedAt: timestamp("triaged_at", { withTimezone: true, mode: "string" }),
  triagedByUserId: text("triaged_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
  closedByUserId: text("closed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  closureReason: text("closure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("prevention_incidents_sfti_external_unique").on(table.sftiExternalId)
    .where(sql`${table.sftiExternalId} IS NOT NULL`),
  uniqueIndex("prevention_incidents_import_row_unique").on(table.importRowId)
    .where(sql`${table.importRowId} IS NOT NULL`),
  index("prevention_incidents_worksite_status_idx").on(table.worksiteId, table.status),
  index("prevention_incidents_occurred_idx").on(table.occurredAt),
  index("prevention_incidents_known_idx").on(table.knownAt),
  check("prevention_incident_type_valid", sql`${table.eventType} IN ('dangerous_incident', 'work_accident', 'commute_accident', 'suspected_occupational_disease', 'material_damage', 'environmental_spill', 'vehicle_event', 'contractor_or_third_party')`),
  check("prevention_incident_status_valid", sql`${table.status} IN ('reported', 'triage', 'immediate_measures', 'under_investigation', 'pending_capa', 'pending_verification', 'closed')`),
  check("prevention_incident_actual_severity_valid", sql`${table.actualSeverity} IN ('none', 'minor', 'medical_treatment', 'lost_time', 'serious', 'fatal')`),
  check("prevention_incident_potential_severity_valid", sql`${table.potentialSeverity} IN ('low', 'medium', 'high', 'critical', 'fatal')`),
  check("prevention_incident_source_valid", sql`${table.source} IN ('platform', 'offline_sync', 'sfti_import')`),
  check("prevention_incident_version_positive", sql`${table.version} >= 1`),
  check("prevention_incident_times_consistent", sql`${table.knownAt} >= ${table.occurredAt}`),
])

export const preventionIncidentPeople = pgTable("prevention_incident_people", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  workerId: text("worker_id").references(() => workers.id, { onDelete: "restrict" }),
  displayLabel: text("display_label").notNull(),
  employerName: text("employer_name").notNull(),
  sex: text("sex"),
  relationshipType: text("relationship_type").notNull(),
  absenceAtLeastNormalShift: boolean("absence_at_least_normal_shift").notNull().default(false),
  absenceDays: integer("absence_days").notNull().default(0),
  chargeDays: integer("charge_days").notNull().default(0),
  administratorQualification: text("administrator_qualification"),
  indicatorInclusionStatus: text("indicator_inclusion_status").notNull().default("pending"),
  indicatorInclusionReason: text("indicator_inclusion_reason"),
  indicatorClassifiedByUserId: text("indicator_classified_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  indicatorClassifiedAt: timestamp("indicator_classified_at", { withTimezone: true, mode: "string" }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("prevention_incident_people_incident_idx").on(table.incidentId),
  index("prevention_incident_people_worker_idx").on(table.workerId),
  check("prevention_incident_person_sex_valid", sql`${table.sex} IS NULL OR ${table.sex} IN ('female', 'male', 'intersex', 'unspecified')`),
  check("prevention_incident_person_relationship_valid", sql`${table.relationshipType} IN ('employee', 'contractor', 'subcontractor', 'visitor', 'third_party')`),
  check("prevention_incident_person_days_nonnegative", sql`${table.absenceDays} >= 0 AND ${table.chargeDays} >= 0`),
  check("prevention_incident_person_indicator_status_valid", sql`${table.indicatorInclusionStatus} IN ('pending', 'included', 'excluded')`),
  check("prevention_incident_person_indicator_classification_consistent", sql`${table.indicatorInclusionStatus} = 'pending' OR (${table.indicatorInclusionReason} IS NOT NULL AND ${table.indicatorClassifiedByUserId} IS NOT NULL AND ${table.indicatorClassifiedAt} IS NOT NULL)`),
  check("prevention_incident_person_version_positive", sql`${table.version} >= 1`),
])

export const preventionIncidentPersonSensitivePayloads = pgTable("prevention_incident_person_sensitive_payloads", {
  id: text("id").primaryKey(),
  personId: text("person_id").notNull().unique().references(() => preventionIncidentPeople.id, { onDelete: "cascade" }),
  encryptedPayload: text("encrypted_payload").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  keyVersion: text("key_version").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  updatedByUserId: text("updated_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export const preventionIncidentNotifications = pgTable("prevention_incident_notifications", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  notificationType: text("notification_type").notNull(),
  deadlineAt: timestamp("deadline_at", { withTimezone: true, mode: "string" }),
  status: text("status").notNull().default("pending"),
  administratorName: text("administrator_name"),
  responsibleUserId: text("responsible_user_id").references(() => users.id, { onDelete: "restrict" }),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
  evidenceReference: text("evidence_reference"),
  evidenceChecksumSha256: text("evidence_checksum_sha256"),
  observations: text("observations"),
  escalatedAt: timestamp("escalated_at", { withTimezone: true, mode: "string" }),
  restartAuthorizedAt: timestamp("restart_authorized_at", { withTimezone: true, mode: "string" }),
  restartAuthorizedByUserId: text("restart_authorized_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  restartAuthorizationReason: text("restart_authorization_reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("prevention_incident_notification_type_unique").on(table.incidentId, table.notificationType),
  index("prevention_incident_notification_deadline_idx").on(table.deadlineAt, table.status),
  index("prevention_incident_notification_responsible_idx").on(table.responsibleUserId, table.status),
  check("prevention_incident_notification_type_valid", sql`${table.notificationType} IN ('diat', 'diep', 'fatal_dt', 'fatal_seremi', 'restart_authorization')`),
  check("prevention_incident_notification_status_valid", sql`${table.status} IN ('pending', 'sent', 'acknowledged', 'not_required', 'overdue', 'authorized')`),
  check("prevention_incident_notification_checksum_valid", sql`${table.evidenceChecksumSha256} IS NULL OR length(${table.evidenceChecksumSha256}) = 64`),
])

export const preventionIncidentInvestigations = pgTable("prevention_incident_investigations", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull().unique().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("draft"),
  methodology: text("methodology").notNull(),
  team: jsonb("team").$type<Array<{ userId: string; role: string }>>().notNull().default([]),
  evidenceSummary: text("evidence_summary"),
  immediateCauses: jsonb("immediate_causes").$type<string[]>().notNull().default([]),
  basicCauses: jsonb("basic_causes").$type<string[]>().notNull().default([]),
  organizationalCauses: jsonb("organizational_causes").$type<string[]>().notNull().default([]),
  failedControls: jsonb("failed_controls").$type<string[]>().notNull().default([]),
  conclusions: text("conclusions"),
  interviewsEncrypted: text("interviews_encrypted"),
  interviewsIv: text("interviews_iv"),
  interviewsAuthTag: text("interviews_auth_tag"),
  interviewsKeyVersion: text("interviews_key_version"),
  miperUpdateRequired: boolean("miper_update_required").notNull().default(false),
  miperUpdatedAt: timestamp("miper_updated_at", { withTimezone: true, mode: "string" }),
  procedureUpdateRequired: boolean("procedure_update_required").notNull().default(false),
  procedureUpdatedAt: timestamp("procedure_updated_at", { withTimezone: true, mode: "string" }),
  trainingRequired: boolean("training_required").notNull().default(false),
  trainingCompletedAt: timestamp("training_completed_at", { withTimezone: true, mode: "string" }),
  startedByUserId: text("started_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
  completedByUserId: text("completed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  check("prevention_incident_investigation_status_valid", sql`${table.status} IN ('draft', 'in_progress', 'completed', 'reopened')`),
  check("prevention_incident_investigation_version_positive", sql`${table.version} >= 1`),
])

export const preventionIncidentEvidence = pgTable("prevention_incident_evidence", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  investigationId: text("investigation_id").references(() => preventionIncidentInvestigations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  reference: text("reference").notNull(),
  description: text("description"),
  checksumSha256: text("checksum_sha256"),
  isSensitive: boolean("is_sensitive").notNull().default(false),
  capturedAt: timestamp("captured_at", { withTimezone: true, mode: "string" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("prevention_incident_evidence_incident_idx").on(table.incidentId, table.createdAt),
  check("prevention_incident_evidence_kind_valid", sql`${table.kind} IN ('document', 'photo', 'video', 'interview', 'diagram', 'external_reference', 'note')`),
  check("prevention_incident_evidence_checksum_valid", sql`${table.checksumSha256} IS NULL OR length(${table.checksumSha256}) = 64`),
])

export const preventionIncidentHistory = pgTable("prevention_incident_history", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  changeType: text("change_type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  reason: text("reason"),
  changeSet: jsonb("change_set").$type<Record<string, unknown>>(),
  actorUserId: text("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("prevention_incident_history_incident_idx").on(table.incidentId, table.createdAt),
  check("prevention_incident_history_type_valid", sql`${table.changeType} IN ('reported', 'status', 'triage', 'immediate_measures', 'person', 'notification', 'investigation', 'evidence', 'capa', 'restart', 'closure', 'import', 'correction')`),
])

export const preventionIncidentImportBatches = pgTable("prevention_incident_import_batches", {
  id: text("id").primaryKey(),
  sourceSystem: text("source_system").notNull().default("SFTI"),
  sourceFileName: text("source_file_name").notNull(),
  sourceChecksumSha256: text("source_checksum_sha256").notNull().unique(),
  sourceEncryptedPath: text("source_encrypted_path").notNull(),
  sourceCiphertextChecksumSha256: text("source_ciphertext_checksum_sha256").notNull(),
  sourceIv: text("source_iv").notNull(),
  sourceAuthTag: text("source_auth_tag").notNull(),
  sourceKeyVersion: text("source_key_version").notNull(),
  status: text("status").notNull().default("staging"),
  totalRows: integer("total_rows").notNull().default(0),
  readyRows: integer("ready_rows").notNull().default(0),
  duplicateRows: integer("duplicate_rows").notNull().default(0),
  reviewRows: integer("review_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  activatedRows: integer("activated_rows").notNull().default(0),
  reconciliation: jsonb("reconciliation").$type<Record<string, unknown>>(),
  importedByUserId: text("imported_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  approvedByUserId: text("approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
  activatedByUserId: text("activated_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("prevention_incident_import_status_idx").on(table.status, table.createdAt),
  check("prevention_incident_import_status_valid", sql`${table.status} IN ('staging', 'review', 'approved', 'activated', 'rejected')`),
  check("prevention_incident_import_counts_nonnegative", sql`${table.totalRows} >= 0 AND ${table.readyRows} >= 0 AND ${table.duplicateRows} >= 0 AND ${table.reviewRows} >= 0 AND ${table.errorRows} >= 0 AND ${table.activatedRows} >= 0`),
])

export const preventionIncidentImportRows = pgTable("prevention_incident_import_rows", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => preventionIncidentImportBatches.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  rowFingerprint: text("row_fingerprint").notNull(),
  sourceExternalId: text("source_external_id"),
  originalEncrypted: text("original_encrypted").notNull(),
  originalIv: text("original_iv").notNull(),
  originalAuthTag: text("original_auth_tag").notNull(),
  originalKeyVersion: text("original_key_version").notNull(),
  normalized: jsonb("normalized").$type<Record<string, unknown>>().notNull(),
  resolutionStatus: text("resolution_status").notNull(),
  worksiteId: text("worksite_id").references(() => worksites.id, { onDelete: "restrict" }),
  workerId: text("worker_id").references(() => workers.id, { onDelete: "restrict" }),
  issues: jsonb("issues").$type<string[]>().notNull().default([]),
  incidentId: text("incident_id").references(() => preventionIncidents.id, { onDelete: "restrict" }),
  reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("prevention_incident_import_row_number_unique").on(table.batchId, table.rowNumber),
  index("prevention_incident_import_row_status_idx").on(table.batchId, table.resolutionStatus),
  index("prevention_incident_import_row_external_idx").on(table.sourceExternalId),
  check("prevention_incident_import_row_number_positive", sql`${table.rowNumber} >= 1`),
  check("prevention_incident_import_row_resolution_valid", sql`${table.resolutionStatus} IN ('ready', 'duplicate', 'needs_review', 'approved', 'activated', 'error')`),
])

export const preventionIncidentsRelations = relations(preventionIncidents, ({ one, many }) => ({
  worksite: one(worksites, { fields: [preventionIncidents.worksiteId], references: [worksites.id] }),
  reporter: one(users, { fields: [preventionIncidents.reportedByUserId], references: [users.id], relationName: "preventionIncidentReporter" }),
  people: many(preventionIncidentPeople),
  notifications: many(preventionIncidentNotifications),
  investigation: one(preventionIncidentInvestigations, { fields: [preventionIncidents.id], references: [preventionIncidentInvestigations.incidentId] }),
  evidence: many(preventionIncidentEvidence),
  history: many(preventionIncidentHistory),
}))

export const preventionIncidentPeopleRelations = relations(preventionIncidentPeople, ({ one }) => ({
  incident: one(preventionIncidents, { fields: [preventionIncidentPeople.incidentId], references: [preventionIncidents.id] }),
  worker: one(workers, { fields: [preventionIncidentPeople.workerId], references: [workers.id] }),
  sensitivePayload: one(preventionIncidentPersonSensitivePayloads, { fields: [preventionIncidentPeople.id], references: [preventionIncidentPersonSensitivePayloads.personId] }),
}))

export const preventionIncidentNotificationsRelations = relations(preventionIncidentNotifications, ({ one }) => ({
  incident: one(preventionIncidents, { fields: [preventionIncidentNotifications.incidentId], references: [preventionIncidents.id] }),
  responsible: one(users, { fields: [preventionIncidentNotifications.responsibleUserId], references: [users.id] }),
}))

export const preventionIncidentInvestigationsRelations = relations(preventionIncidentInvestigations, ({ one, many }) => ({
  incident: one(preventionIncidents, { fields: [preventionIncidentInvestigations.incidentId], references: [preventionIncidents.id] }),
  evidence: many(preventionIncidentEvidence),
}))

export const preventionIncidentEvidenceRelations = relations(preventionIncidentEvidence, ({ one }) => ({
  incident: one(preventionIncidents, { fields: [preventionIncidentEvidence.incidentId], references: [preventionIncidents.id] }),
  investigation: one(preventionIncidentInvestigations, { fields: [preventionIncidentEvidence.investigationId], references: [preventionIncidentInvestigations.id] }),
}))

export const preventionIncidentHistoryRelations = relations(preventionIncidentHistory, ({ one }) => ({
  incident: one(preventionIncidents, { fields: [preventionIncidentHistory.incidentId], references: [preventionIncidents.id] }),
  actor: one(users, { fields: [preventionIncidentHistory.actorUserId], references: [users.id] }),
}))

export const preventionIncidentImportBatchesRelations = relations(preventionIncidentImportBatches, ({ many }) => ({
  rows: many(preventionIncidentImportRows),
}))

export const preventionIncidentImportRowsRelations = relations(preventionIncidentImportRows, ({ one }) => ({
  batch: one(preventionIncidentImportBatches, { fields: [preventionIncidentImportRows.batchId], references: [preventionIncidentImportBatches.id] }),
  incident: one(preventionIncidents, { fields: [preventionIncidentImportRows.incidentId], references: [preventionIncidents.id] }),
  worksite: one(worksites, { fields: [preventionIncidentImportRows.worksiteId], references: [worksites.id] }),
  worker: one(workers, { fields: [preventionIncidentImportRows.workerId], references: [workers.id] }),
}))

export type PreventionIncident = typeof preventionIncidents.$inferSelect
export type PreventionIncidentPerson = typeof preventionIncidentPeople.$inferSelect
export type PreventionIncidentNotification = typeof preventionIncidentNotifications.$inferSelect
export type PreventionIncidentInvestigation = typeof preventionIncidentInvestigations.$inferSelect
export type PreventionIncidentImportBatch = typeof preventionIncidentImportBatches.$inferSelect
export type PreventionIncidentImportRow = typeof preventionIncidentImportRows.$inferSelect

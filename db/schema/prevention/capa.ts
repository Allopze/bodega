import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"

export const preventionCapaActions = pgTable("prevention_capa_actions", {
  id:                    text("id").primaryKey(),
  code:                  text("code").notNull().unique(),
  sourceType:            text("source_type").notNull(),
  sourceId:              text("source_id").notNull(),
  sourceLegacyActionId:  text("source_legacy_action_id"),
  worksiteId:            text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  finding:               text("finding").notNull(),
  immediateMeasure:      text("immediate_measure"),
  rootCause:             text("root_cause"),
  actionDescription:     text("action_description").notNull(),
  responsibleUserId:     text("responsible_user_id").references(() => users.id, { onDelete: "restrict" }),
  responsibleSnapshot:   text("responsible_snapshot"),
  responsibleRole:       text("responsible_role"),
  priority:              text("priority").notNull().default("medium"),
  targetDate:            text("target_date").notNull(),
  status:                text("status").notNull().default("pending"),
  evidenceRequired:      boolean("evidence_required").notNull().default(true),
  // Separa la respuesta de terreno del plazo administrativo. Un hallazgo de
  // consecuencia potencialmente fatal exige detener la tarea de inmediato,
  // pero cerrar la acción con evidencia toma otro tiempo. Antes ambas cosas
  // se expresaban con un plazo "hoy", que sólo producía acciones vencidas.
  requiresImmediateStop: boolean("requires_immediate_stop").notNull().default(false),
  createdByUserId:       text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  startedByUserId:       text("started_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  startedAt:             timestamp("started_at", { withTimezone: true, mode: "string" }),
  completedByUserId:     text("completed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  completedAt:           timestamp("completed_at", { withTimezone: true, mode: "string" }),
  verifiedByUserId:      text("verified_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  verifiedAt:            timestamp("verified_at", { withTimezone: true, mode: "string" }),
  closedByUserId:        text("closed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  closedAt:              timestamp("closed_at", { withTimezone: true, mode: "string" }),
  effectivenessStatus:   text("effectiveness_status").notNull().default("pending"),
  effectivenessAssessment:text("effectiveness_assessment"),
  effectivenessAssessedByUserId: text("effectiveness_assessed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  effectivenessAssessedAt: timestamp("effectiveness_assessed_at", { withTimezone: true, mode: "string" }),
  reopenedByUserId:      text("reopened_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  reopenedAt:            timestamp("reopened_at", { withTimezone: true, mode: "string" }),
  reopenedReason:        text("reopened_reason"),
  cancelledByUserId:     text("cancelled_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  cancelledAt:           timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  cancellationReason:    text("cancellation_reason"),
  reconciliationStatus:  text("reconciliation_status").notNull().default("reconciled"),
  legacySnapshot:        jsonb("legacy_snapshot"),
  version:               integer("version").notNull().default(1),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("prevention_capa_legacy_source_unique").on(table.sourceType, table.sourceLegacyActionId),
  index("prevention_capa_worksite_status_idx").on(table.worksiteId, table.status),
  index("prevention_capa_source_idx").on(table.sourceType, table.sourceId),
  index("prevention_capa_responsible_status_idx").on(table.responsibleUserId, table.status),
  index("prevention_capa_target_date_idx").on(table.targetDate),
  check("prevention_capa_source_type_valid", sql`${table.sourceType} IN ('pdtp', 'sst_evaluation', 'ppa', 'incident', 'risk', 'legal_requirement', 'training', 'contractor', 'work_permit', 'inspection', 'cphs', 'manual')`),
  check("prevention_capa_priority_valid", sql`${table.priority} IN ('low', 'medium', 'high', 'critical')`),
  check("prevention_capa_status_valid", sql`${table.status} IN ('pending', 'in_progress', 'pending_verification', 'verified', 'closed', 'reopened', 'cancelled')`),
  check("prevention_capa_effectiveness_valid", sql`${table.effectivenessStatus} IN ('pending', 'effective', 'ineffective', 'not_required', 'legacy_not_assessed')`),
  check("prevention_capa_reconciliation_valid", sql`${table.reconciliationStatus} IN ('reconciled', 'needs_assignment', 'needs_evidence', 'needs_review')`),
  check("prevention_capa_version_positive", sql`${table.version} >= 1`),
  check("prevention_capa_reopen_consistent", sql`(${table.reopenedAt} IS NULL AND ${table.reopenedByUserId} IS NULL AND ${table.reopenedReason} IS NULL) OR (${table.reopenedAt} IS NOT NULL AND ${table.reopenedByUserId} IS NOT NULL AND length(${table.reopenedReason}) >= 5)`),
  check("prevention_capa_cancel_consistent", sql`(${table.cancelledAt} IS NULL AND ${table.cancelledByUserId} IS NULL AND ${table.cancellationReason} IS NULL) OR (${table.cancelledAt} IS NOT NULL AND ${table.cancelledByUserId} IS NOT NULL AND length(${table.cancellationReason}) >= 5)`),
])

export const preventionCapaTransitions = pgTable("prevention_capa_transitions", {
  id:          text("id").primaryKey(),
  actionId:    text("action_id").notNull().references(() => preventionCapaActions.id, { onDelete: "cascade" }),
  changeType:  text("change_type").notNull(),
  fromStatus:  text("from_status"),
  toStatus:    text("to_status"),
  reason:      text("reason"),
  changeSet:   jsonb("change_set"),
  actorUserId: text("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("prevention_capa_transition_action_idx").on(table.actionId, table.createdAt),
  check("prevention_capa_transition_type_valid", sql`${table.changeType} IN ('created', 'status', 'assignment', 'target_date', 'priority', 'evidence', 'followup', 'backfill')`),
])

export const preventionCapaFollowups = pgTable("prevention_capa_followups", {
  id:          text("id").primaryKey(),
  actionId:    text("action_id").notNull().references(() => preventionCapaActions.id, { onDelete: "cascade" }),
  note:        text("note").notNull(),
  progress:    integer("progress"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("prevention_capa_followup_action_idx").on(table.actionId, table.createdAt),
  check("prevention_capa_followup_progress_valid", sql`${table.progress} IS NULL OR ${table.progress} BETWEEN 0 AND 100`),
])

export const preventionCapaEvidence = pgTable("prevention_capa_evidence", {
  id:          text("id").primaryKey(),
  actionId:    text("action_id").notNull().references(() => preventionCapaActions.id, { onDelete: "cascade" }),
  kind:        text("kind").notNull(),
  reference:   text("reference").notNull(),
  description: text("description"),
  checksumSha256: text("checksum_sha256"),
  uploadedByUserId: text("uploaded_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("prevention_capa_evidence_action_idx").on(table.actionId, table.createdAt),
  check("prevention_capa_evidence_kind_valid", sql`${table.kind} IN ('document', 'photo', 'url', 'note')`),
  check("prevention_capa_evidence_checksum_valid", sql`${table.checksumSha256} IS NULL OR length(${table.checksumSha256}) = 64`),
])

export const preventionCapaActionsRelations = relations(preventionCapaActions, ({ one, many }) => ({
  worksite: one(worksites, { fields: [preventionCapaActions.worksiteId], references: [worksites.id] }),
  responsible: one(users, { fields: [preventionCapaActions.responsibleUserId], references: [users.id], relationName: "preventionCapaResponsible" }),
  creator: one(users, { fields: [preventionCapaActions.createdByUserId], references: [users.id], relationName: "preventionCapaCreator" }),
  transitions: many(preventionCapaTransitions),
  followups: many(preventionCapaFollowups),
  evidence: many(preventionCapaEvidence),
}))

export const preventionCapaTransitionsRelations = relations(preventionCapaTransitions, ({ one }) => ({
  action: one(preventionCapaActions, { fields: [preventionCapaTransitions.actionId], references: [preventionCapaActions.id] }),
  actor: one(users, { fields: [preventionCapaTransitions.actorUserId], references: [users.id] }),
}))

export const preventionCapaFollowupsRelations = relations(preventionCapaFollowups, ({ one }) => ({
  action: one(preventionCapaActions, { fields: [preventionCapaFollowups.actionId], references: [preventionCapaActions.id] }),
  creator: one(users, { fields: [preventionCapaFollowups.createdByUserId], references: [users.id] }),
}))

export const preventionCapaEvidenceRelations = relations(preventionCapaEvidence, ({ one }) => ({
  action: one(preventionCapaActions, { fields: [preventionCapaEvidence.actionId], references: [preventionCapaActions.id] }),
  uploader: one(users, { fields: [preventionCapaEvidence.uploadedByUserId], references: [users.id] }),
}))

export type PreventionCapaAction = typeof preventionCapaActions.$inferSelect
export type PreventionCapaTransition = typeof preventionCapaTransitions.$inferSelect
export type PreventionCapaFollowup = typeof preventionCapaFollowups.$inferSelect
export type PreventionCapaEvidence = typeof preventionCapaEvidence.$inferSelect

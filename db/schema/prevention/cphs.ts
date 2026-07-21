import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { workers, worksites } from "../worksites"
import { preventionCapaActions } from "./capa"

/* ── Comité Paritario por centro de trabajo ───────────────────────────────
 * El DS 44 exige consulta y participación, y comité donde corresponda. El
 * mandato tiene vigencia: un comité vencido deja de ser un órgano válido.
 */
export const preventionCommittees = pgTable("prevention_committees", {
  id:               text("id").primaryKey(),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  name:             text("name").notNull(),
  constitutedOn:    text("constituted_on").notNull(),
  mandateEndsOn:    text("mandate_ends_on").notNull(),
  status:           text("status").notNull().default("active"),
  meetingDayOfMonth: integer("meeting_day_of_month"),
  dissolvedReason:  text("dissolved_reason"),
  dissolvedAt:      timestamp("dissolved_at", { withTimezone: true, mode: "string" }),
  version:          integer("version").notNull().default(1),
  createdByUserId:  text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_committee_active_worksite_unique").on(table.worksiteId)
    .where(sql`${table.status} = 'active'`),
  check("prevention_committee_status_valid", sql`${table.status} IN ('active', 'dissolved', 'expired')`),
  check("prevention_committee_mandate_valid", sql`${table.mandateEndsOn} > ${table.constitutedOn}`),
  check("prevention_committee_meeting_day_valid", sql`${table.meetingDayOfMonth} IS NULL OR ${table.meetingDayOfMonth} BETWEEN 1 AND 28`),
  check("prevention_committee_dissolve_consistent", sql`(${table.dissolvedAt} IS NULL AND ${table.dissolvedReason} IS NULL) OR (${table.dissolvedAt} IS NOT NULL AND length(${table.dissolvedReason}) >= 10)`),
  check("prevention_committee_version_positive", sql`${table.version} >= 1`),
])

/* ── Integrantes ──────────────────────────────────────────────────────────
 * El comité es paritario: representantes de la empresa y de las personas
 * trabajadoras, cada cual titular o suplente.
 */
export const preventionCommitteeMembers = pgTable("prevention_committee_members", {
  id:             text("id").primaryKey(),
  committeeId:    text("committee_id").notNull().references(() => preventionCommittees.id, { onDelete: "cascade" }),
  workerId:       text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  representation: text("representation").notNull(),
  seat:           text("seat").notNull(),
  role:           text("role"),
  electedOn:      text("elected_on"),
  termEndsOn:     text("term_ends_on"),
  hasFuero:       boolean("has_fuero").notNull().default(false),
  status:         text("status").notNull().default("active"),
  replacedByMemberId: text("replaced_by_member_id"),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_committee_member_unique").on(table.committeeId, table.workerId)
    .where(sql`${table.status} = 'active'`),
  index("prevention_committee_member_committee_idx").on(table.committeeId, table.status),
  check("prevention_committee_member_representation_valid", sql`${table.representation} IN ('company', 'workers')`),
  check("prevention_committee_member_seat_valid", sql`${table.seat} IN ('titular', 'suplente')`),
  check("prevention_committee_member_role_valid", sql`${table.role} IS NULL OR ${table.role} IN ('presidente', 'secretario', 'integrante')`),
  check("prevention_committee_member_status_valid", sql`${table.status} IN ('active', 'replaced', 'resigned')`),
])

/* ── Sesiones y actas ─────────────────────────────────────────────────────── */
export const preventionCommitteeMeetings = pgTable("prevention_committee_meetings", {
  id:              text("id").primaryKey(),
  code:            text("code").notNull().unique(),
  committeeId:     text("committee_id").notNull().references(() => preventionCommittees.id, { onDelete: "cascade" }),
  meetingType:     text("meeting_type").notNull().default("ordinary"),
  scheduledFor:    timestamp("scheduled_for", { withTimezone: true, mode: "string" }).notNull(),
  heldAt:          timestamp("held_at", { withTimezone: true, mode: "string" }),
  agenda:          text("agenda").notNull(),
  minutes:         text("minutes"),
  status:          text("status").notNull().default("scheduled"),
  quorumReached:   boolean("quorum_reached").notNull().default(false),
  closedByUserId:  text("closed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  closedAt:        timestamp("closed_at", { withTimezone: true, mode: "string" }),
  cancellationReason: text("cancellation_reason"),
  version:         integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_committee_meeting_committee_idx").on(table.committeeId, table.scheduledFor),
  check("prevention_committee_meeting_type_valid", sql`${table.meetingType} IN ('ordinary', 'extraordinary')`),
  check("prevention_committee_meeting_status_valid", sql`${table.status} IN ('scheduled', 'held', 'closed', 'cancelled')`),
  check("prevention_committee_meeting_closed_has_minutes", sql`${table.status} <> 'closed' OR length(${table.minutes}) >= 20`),
  check("prevention_committee_meeting_cancel_consistent", sql`${table.status} <> 'cancelled' OR length(${table.cancellationReason}) >= 10`),
  check("prevention_committee_meeting_version_positive", sql`${table.version} >= 1`),
])

/* ── Asistencia nominativa ────────────────────────────────────────────────── */
export const preventionCommitteeAttendance = pgTable("prevention_committee_attendance", {
  id:        text("id").primaryKey(),
  meetingId: text("meeting_id").notNull().references(() => preventionCommitteeMeetings.id, { onDelete: "cascade" }),
  memberId:  text("member_id").notNull().references(() => preventionCommitteeMembers.id, { onDelete: "cascade" }),
  attended:  boolean("attended").notNull().default(false),
  excuseReason: text("excuse_reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_committee_attendance_unique").on(table.meetingId, table.memberId),
])

/* ── Acuerdos ─────────────────────────────────────────────────────────────
 * Todo acuerdo con responsable y plazo se deriva a CAPA común: un acuerdo sin
 * acción trazable no es seguimiento, es una nota.
 */
export const preventionCommitteeAgreements = pgTable("prevention_committee_agreements", {
  id:             text("id").primaryKey(),
  meetingId:      text("meeting_id").notNull().references(() => preventionCommitteeMeetings.id, { onDelete: "cascade" }),
  description:    text("description").notNull(),
  capaActionId:   text("capa_action_id").references(() => preventionCapaActions.id, { onDelete: "set null" }),
  status:         text("status").notNull().default("open"),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_committee_agreement_meeting_idx").on(table.meetingId, table.status),
  check("prevention_committee_agreement_status_valid", sql`${table.status} IN ('open', 'capa_linked', 'closed')`),
])

/* ── Revisión por la dirección ────────────────────────────────────────────
 * DS 44 art. 22: el SG-SST se evalúa, no sólo se ejecuta. Las decisiones y
 * compromisos quedan trazables, y los compromisos con plazo van a CAPA.
 */
export const preventionManagementReviews = pgTable("prevention_management_reviews", {
  id:              text("id").primaryKey(),
  code:            text("code").notNull().unique(),
  worksiteId:      text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  periodLabel:     text("period_label").notNull(),
  heldAt:          timestamp("held_at", { withTimezone: true, mode: "string" }).notNull(),
  inputs:          jsonb("inputs").notNull(),
  conclusions:     text("conclusions"),
  resourceDecisions: text("resource_decisions"),
  status:          text("status").notNull().default("draft"),
  closedByUserId:  text("closed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  closedAt:        timestamp("closed_at", { withTimezone: true, mode: "string" }),
  version:         integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_management_review_period_idx").on(table.periodLabel, table.heldAt),
  check("prevention_management_review_status_valid", sql`${table.status} IN ('draft', 'closed')`),
  check("prevention_management_review_closed_consistent", sql`${table.status} <> 'closed' OR (length(${table.conclusions}) >= 20 AND ${table.closedByUserId} IS NOT NULL AND ${table.closedAt} IS NOT NULL)`),
  check("prevention_management_review_version_positive", sql`${table.version} >= 1`),
])

/* ── Historial inmutable ──────────────────────────────────────────────────── */
export const preventionGovernanceHistory = pgTable("prevention_governance_history", {
  id:          text("id").primaryKey(),
  entityType:  text("entity_type").notNull(),
  entityId:    text("entity_id").notNull(),
  worksiteId:  text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  changeType:  text("change_type").notNull(),
  reason:      text("reason").notNull(),
  beforeState: jsonb("before_state"),
  afterState:  jsonb("after_state"),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_governance_history_entity_idx").on(table.entityType, table.entityId, table.createdAt),
])

/* ── Relations ────────────────────────────────────────────────────────────── */
export const preventionCommitteesRelations = relations(preventionCommittees, ({ one, many }) => ({
  worksite: one(worksites, { fields: [preventionCommittees.worksiteId], references: [worksites.id] }),
  members: many(preventionCommitteeMembers),
  meetings: many(preventionCommitteeMeetings),
}))

export const preventionCommitteeMembersRelations = relations(preventionCommitteeMembers, ({ one }) => ({
  committee: one(preventionCommittees, { fields: [preventionCommitteeMembers.committeeId], references: [preventionCommittees.id] }),
  worker: one(workers, { fields: [preventionCommitteeMembers.workerId], references: [workers.id] }),
}))

export const preventionCommitteeMeetingsRelations = relations(preventionCommitteeMeetings, ({ one, many }) => ({
  committee: one(preventionCommittees, { fields: [preventionCommitteeMeetings.committeeId], references: [preventionCommittees.id] }),
  attendance: many(preventionCommitteeAttendance),
  agreements: many(preventionCommitteeAgreements),
}))

export const preventionCommitteeAttendanceRelations = relations(preventionCommitteeAttendance, ({ one }) => ({
  meeting: one(preventionCommitteeMeetings, { fields: [preventionCommitteeAttendance.meetingId], references: [preventionCommitteeMeetings.id] }),
  member: one(preventionCommitteeMembers, { fields: [preventionCommitteeAttendance.memberId], references: [preventionCommitteeMembers.id] }),
}))

export const preventionCommitteeAgreementsRelations = relations(preventionCommitteeAgreements, ({ one }) => ({
  meeting: one(preventionCommitteeMeetings, { fields: [preventionCommitteeAgreements.meetingId], references: [preventionCommitteeMeetings.id] }),
  capaAction: one(preventionCapaActions, { fields: [preventionCommitteeAgreements.capaActionId], references: [preventionCapaActions.id] }),
}))

export type PreventionCommittee = typeof preventionCommittees.$inferSelect
export type PreventionCommitteeMember = typeof preventionCommitteeMembers.$inferSelect
export type PreventionCommitteeMeeting = typeof preventionCommitteeMeetings.$inferSelect
export type PreventionCommitteeAgreement = typeof preventionCommitteeAgreements.$inferSelect
export type PreventionManagementReview = typeof preventionManagementReviews.$inferSelect

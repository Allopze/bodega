import { relations } from "drizzle-orm"
import { index, integer, jsonb, numeric, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"

export const pdtpPrograms = pgTable("pdtp_programs", {
  id:                    text("id").primaryKey(),
  year:                  integer("year").notNull(),
  version:               integer("version").notNull(),
  status:                text("status").notNull().default("draft"),
  title:                 text("title").notNull(),
  elaboratedByUserId:    text("elaborated_by_user_id").references(() => users.id),
  elaboratedByName:      text("elaborated_by_name").notNull(),
  elaboratedByTitle:     text("elaborated_by_title").notNull(),
  approvedByJdprUserId:  text("approved_by_jdpr_user_id").references(() => users.id),
  approvedByJdprAt:      timestamp("approved_by_jdpr_at", { withTimezone: true, mode: "string" }),
  approvedByLegalUserId: text("approved_by_legal_user_id").references(() => users.id),
  approvedByLegalAt:     timestamp("approved_by_legal_at", { withTimezone: true, mode: "string" }),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  complianceTarget:      numeric("compliance_target", { precision: 5, scale: 2, mode: "number" }).notNull().default(0.9),
}, (table) => [
  uniqueIndex("pdtp_programs_year_version_unique").on(table.year, table.version),
  index("pdtp_programs_status_idx").on(table.status),
])

export const pdtpResponsibleCatalog = pgTable("pdtp_responsible_catalog", {
  slug:        text("slug").primaryKey(),
  displayName: text("display_name").notNull(),
  roleName:    text("role_name"),
  kind:        text("kind").notNull(),
  notes:       text("notes"),
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
  sourceSheetRow:     integer("source_sheet_row").notNull(),
  notes:              text("notes"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_activities_program_n_unique").on(table.programId, table.n),
  index("pdtp_activities_program_objective_idx").on(table.programId, table.objectiveOrder),
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
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_executions_activity_scope_period_unique").on(table.activityId, table.worksiteId, table.year, table.month, table.week),
  index("pdtp_executions_worksite_period_idx").on(table.worksiteId, table.year, table.month),
  index("pdtp_executions_status_idx").on(table.status),
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
])

export const pdtpSheets = pgTable("pdtp_sheets", {
  code:              text("code").primaryKey(),
  label:             text("label").notNull(),
  area:              text("area").notNull(),
  defaultScopeRoles: jsonb("default_scope_roles").notNull(),
}, (table) => [
  uniqueIndex("pdtp_sheets_label_unique").on(table.label),
])

export const pdtpSheetActivities = pgTable("pdtp_sheet_activities", {
  id:           text("id").primaryKey(),
  sheetCode:    text("sheet_code").notNull().references(() => pdtpSheets.code, { onDelete: "cascade" }),
  activityId:   text("activity_id").notNull().references(() => pdtpActivities.id, { onDelete: "cascade" }),
  sheetRow:     integer("sheet_row").notNull(),
  displayOrder: integer("display_order").notNull(),
}, (table) => [
  uniqueIndex("pdtp_sheet_activities_sheet_activity_unique").on(table.sheetCode, table.activityId),
  index("pdtp_sheet_activities_sheet_order_idx").on(table.sheetCode, table.displayOrder),
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
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const pdtpProgramsRelations = relations(pdtpPrograms, ({ many, one }) => ({
  elaboratedByUser: one(users, { fields: [pdtpPrograms.elaboratedByUserId], references: [users.id] }),
  approvedByJdprUser: one(users, { fields: [pdtpPrograms.approvedByJdprUserId], references: [users.id] }),
  approvedByLegalUser: one(users, { fields: [pdtpPrograms.approvedByLegalUserId], references: [users.id] }),
  activities: many(pdtpActivities),
  changeLog: many(pdtpChangeLog),
}))

export const pdtpActivitiesRelations = relations(pdtpActivities, ({ one, many }) => ({
  program: one(pdtpPrograms, { fields: [pdtpActivities.programId], references: [pdtpPrograms.id] }),
  schedule: many(pdtpActivitySchedule),
  executions: many(pdtpExecutions),
  sheetMemberships: many(pdtpSheetActivities),
}))

export const pdtpActivityScheduleRelations = relations(pdtpActivitySchedule, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpActivitySchedule.activityId], references: [pdtpActivities.id] }),
}))

export const pdtpExecutionsRelations = relations(pdtpExecutions, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpExecutions.activityId], references: [pdtpActivities.id] }),
  worksite: one(worksites, { fields: [pdtpExecutions.worksiteId], references: [worksites.id] }),
  executedByUser: one(users, { fields: [pdtpExecutions.executedByUserId], references: [users.id] }),
  approvedByUser: one(users, { fields: [pdtpExecutions.approvedByUserId], references: [users.id] }),
}))

export const pdtpChangeLogRelations = relations(pdtpChangeLog, ({ one }) => ({
  program: one(pdtpPrograms, { fields: [pdtpChangeLog.programId], references: [pdtpPrograms.id] }),
  changedByUser: one(users, { fields: [pdtpChangeLog.changedByUserId], references: [users.id] }),
}))

export const pdtpSheetsRelations = relations(pdtpSheets, ({ many }) => ({
  activities: many(pdtpSheetActivities),
}))

export const pdtpSheetActivitiesRelations = relations(pdtpSheetActivities, ({ one }) => ({
  sheet: one(pdtpSheets, { fields: [pdtpSheetActivities.sheetCode], references: [pdtpSheets.code] }),
  activity: one(pdtpActivities, { fields: [pdtpSheetActivities.activityId], references: [pdtpActivities.id] }),
}))

export const pdtpActivityScheduleOverridesRelations = relations(pdtpActivityScheduleOverrides, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpActivityScheduleOverrides.activityId], references: [pdtpActivities.id] }),
  worksite: one(worksites, { fields: [pdtpActivityScheduleOverrides.worksiteId], references: [worksites.id] }),
  updatedByUser: one(users, { fields: [pdtpActivityScheduleOverrides.updatedByUserId], references: [users.id] }),
}))

/* ── Types ───────────────────────────────────────────────────────────────── */
export type PdtpProgram = typeof pdtpPrograms.$inferSelect
export type NewPdtpProgram = typeof pdtpPrograms.$inferInsert
export type PdtpResponsibleCatalog = typeof pdtpResponsibleCatalog.$inferSelect
export type NewPdtpResponsibleCatalog = typeof pdtpResponsibleCatalog.$inferInsert
export type PdtpActivity = typeof pdtpActivities.$inferSelect
export type NewPdtpActivity = typeof pdtpActivities.$inferInsert
export type PdtpActivitySchedule = typeof pdtpActivitySchedule.$inferSelect
export type NewPdtpActivitySchedule = typeof pdtpActivitySchedule.$inferInsert
export type PdtpExecution = typeof pdtpExecutions.$inferSelect
export type NewPdtpExecution = typeof pdtpExecutions.$inferInsert
export type PdtpChangeLog = typeof pdtpChangeLog.$inferSelect
export type NewPdtpChangeLog = typeof pdtpChangeLog.$inferInsert
export type PdtpSheet = typeof pdtpSheets.$inferSelect
export type NewPdtpSheet = typeof pdtpSheets.$inferInsert
export type PdtpSheetActivity = typeof pdtpSheetActivities.$inferSelect
export type NewPdtpSheetActivity = typeof pdtpSheetActivities.$inferInsert
export type PdtpActivityScheduleOverride = typeof pdtpActivityScheduleOverrides.$inferSelect
export type NewPdtpActivityScheduleOverride = typeof pdtpActivityScheduleOverrides.$inferInsert

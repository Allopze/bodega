import { relations } from "drizzle-orm"
import { boolean, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites, workers } from "../worksites"

export const equipmentDailyReports = pgTable("equipment_daily_reports", {
  id:               text("id").primaryKey(),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id),
  equipmentId:      text("equipment_id").notNull(),
  operatorWorkerId: text("operator_worker_id").notNull().references(() => workers.id),
  reportedAt:       timestamp("reported_at", { withTimezone: true, mode: "string" }).notNull(),
  shift:            text("shift").notNull(),
  status:           text("status").notNull().default("ok"),
  odometer:         integer("odometer"),
  hourmeter:        integer("hourmeter"),
  checklist:        jsonb("checklist").notNull(),
  signedByWorkerId: text("signed_by_worker_id").references(() => workers.id),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("equipment_daily_reports_ws_date_idx").on(table.worksiteId, table.reportedAt),
  index("equipment_daily_reports_equip_date_idx").on(table.equipmentId, table.reportedAt),
])

export const equipmentReportReviews = pgTable("equipment_report_reviews", {
  id:              text("id").primaryKey(),
  reportId:        text("report_id").notNull().references(() => equipmentDailyReports.id),
  reviewedByUserId: text("reviewed_by_user_id").notNull().references(() => users.id),
  reviewedAt:      timestamp("reviewed_at", { withTimezone: true, mode: "string" }).notNull(),
  status:          text("status").notNull().default("aprobado"),
  findings:        jsonb("findings").notNull(),
  closedAt:        timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("equipment_report_reviews_report_unique").on(table.reportId),
])

export const equipmentChecklists = pgTable("equipment_checklists", {
  id:              text("id").primaryKey(),
  worksiteId:      text("worksite_id").notNull().references(() => worksites.id),
  kind:            text("kind").notNull(),
  assetCode:       text("asset_code").notNull(),
  performedByUserId: text("performed_by_user_id").notNull().references(() => users.id),
  performedAt:     timestamp("performed_at", { withTimezone: true, mode: "string" }).notNull(),
  items:           jsonb("items").notNull(),
  status:          text("status").notNull().default("ok"),
  closeRequired:   boolean("close_required").notNull().default(false),
  closedAt:        timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("equipment_checklists_ws_kind_date_idx").on(table.worksiteId, table.kind, table.performedAt),
])

export const alcoholTests = pgTable("alcohol_tests", {
  id:               text("id").primaryKey(),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id),
  performedByUserId: text("performed_by_user_id").notNull().references(() => users.id),
  testedWorkerId:   text("tested_worker_id").references(() => workers.id),
  shift:            text("shift").notNull(),
  performedAt:      timestamp("performed_at", { withTimezone: true, mode: "string" }).notNull(),
  procedureCode:    text("procedure_code").notNull().default("DO-48"),
  result:           text("result").notNull().default("negativo"),
  evidenceUrl:      text("evidence_url"),
  sentAt:           timestamp("sent_at", { withTimezone: true, mode: "string" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("alcohol_tests_ws_date_idx").on(table.worksiteId, table.performedAt),
  index("alcohol_tests_worker_date_idx").on(table.testedWorkerId, table.performedAt),
])

export const sanitizationControls = pgTable("sanitization_controls", {
  id:               text("id").primaryKey(),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id),
  providerName:     text("provider_name").notNull(),
  serviceDate:      text("service_date").notNull(),
  reportUrl:        text("report_url"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
  reviewedAt:       timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  status:           text("status").notNull().default("pendiente"),
  expiresAt:        text("expires_at"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("sanitization_controls_ws_date_idx").on(table.worksiteId, table.serviceDate),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const equipmentDailyReportsRelations = relations(equipmentDailyReports, ({ one, many }) => ({
  worksite:       one(worksites, { fields: [equipmentDailyReports.worksiteId], references: [worksites.id] }),
  operatorWorker: one(workers, { fields: [equipmentDailyReports.operatorWorkerId], references: [workers.id] }),
  signedByWorker: one(workers, { fields: [equipmentDailyReports.signedByWorkerId], references: [workers.id] }),
  review:         many(equipmentReportReviews),
}))

export const equipmentReportReviewsRelations = relations(equipmentReportReviews, ({ one }) => ({
  report:    one(equipmentDailyReports, { fields: [equipmentReportReviews.reportId], references: [equipmentDailyReports.id] }),
  reviewer:  one(users, { fields: [equipmentReportReviews.reviewedByUserId], references: [users.id] }),
}))

export const equipmentChecklistsRelations = relations(equipmentChecklists, ({ one }) => ({
  worksite:   one(worksites, { fields: [equipmentChecklists.worksiteId], references: [worksites.id] }),
  performer:  one(users, { fields: [equipmentChecklists.performedByUserId], references: [users.id] }),
}))

export const alcoholTestsRelations = relations(alcoholTests, ({ one }) => ({
  worksite:       one(worksites, { fields: [alcoholTests.worksiteId], references: [worksites.id] }),
  performedByUser: one(users, { fields: [alcoholTests.performedByUserId], references: [users.id] }),
  testedWorker:   one(workers, { fields: [alcoholTests.testedWorkerId], references: [workers.id] }),
}))

export const sanitizationControlsRelations = relations(sanitizationControls, ({ one }) => ({
  worksite:  one(worksites, { fields: [sanitizationControls.worksiteId], references: [worksites.id] }),
  reviewer:  one(users, { fields: [sanitizationControls.reviewedByUserId], references: [users.id] }),
}))

/* ── Types ───────────────────────────────────────────────────────────────── */
export type EquipmentDailyReport = typeof equipmentDailyReports.$inferSelect
export type NewEquipmentDailyReport = typeof equipmentDailyReports.$inferInsert
export type EquipmentReportReview = typeof equipmentReportReviews.$inferSelect
export type NewEquipmentReportReview = typeof equipmentReportReviews.$inferInsert
export type EquipmentChecklist = typeof equipmentChecklists.$inferSelect
export type NewEquipmentChecklist = typeof equipmentChecklists.$inferInsert
export type AlcoholTest = typeof alcoholTests.$inferSelect
export type NewAlcoholTest = typeof alcoholTests.$inferInsert
export type SanitizationControl = typeof sanitizationControls.$inferSelect
export type NewSanitizationControl = typeof sanitizationControls.$inferInsert

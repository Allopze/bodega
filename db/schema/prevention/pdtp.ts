import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, numeric, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
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
  // Pesos del cumplimiento integral (suma 1.0). Defaults 0.5/0.3/0.2.
  pesoEjecucion:         real("peso_ejecucion").notNull().default(0.5),
  pesoVerificacion:      real("peso_verificacion").notNull().default(0.3),
  pesoCierre:            real("peso_cierre").notNull().default(0.2),
}, (table) => [
  uniqueIndex("pdtp_programs_year_version_unique").on(table.year, table.version),
  index("pdtp_programs_status_idx").on(table.status),
  check("pdtp_programs_status_check", sql`${table.status} IN ('draft', 'active', 'closed')`),
  check("pdtp_programs_compliance_target_check", sql`${table.complianceTarget} >= 0 AND ${table.complianceTarget} <= 1`),
  check("pdtp_programs_year_check", sql`${table.year} BETWEEN 2024 AND 2100`),
  check("pdtp_programs_pesos_sum_check", sql`${table.pesoEjecucion} + ${table.pesoVerificacion} + ${table.pesoCierre} = 1`),
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
  sourceSheetRow:     integer("source_sheet_row").notNull(),
  notes:              text("notes"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_activities_program_n_unique").on(table.programId, table.n),
  index("pdtp_activities_program_objective_idx").on(table.programId, table.objectiveOrder),
  check("pdtp_activities_n_check", sql`${table.n} >= 1`),
  check("pdtp_activities_objective_order_check", sql`${table.objectiveOrder} BETWEEN 1 AND 8`),
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
  check("pdtp_executions_status_check", sql`${table.status} IN ('draft', 'submitted', 'approved', 'rejected')`),
  check("pdtp_executions_month_check", sql`${table.month} BETWEEN 1 AND 12`),
  check("pdtp_executions_week_check", sql`${table.week} BETWEEN 1 AND 4`),
  check("pdtp_executions_quantity_check", sql`${table.executedQuantity} >= 0`),
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
  index("pdtp_action_plan_execution_idx").on(table.executionId),
  index("pdtp_action_plan_estado_idx").on(table.estado),
  index("pdtp_action_plan_plazo_idx").on(table.plazo),
  check("pdtp_action_plan_origen_check", sql`${table.origen} IN ('checklist_item', 'manual')`),
  check("pdtp_action_plan_prioridad_check", sql`${table.prioridad} IN ('alta', 'media', 'baja')`),
  check("pdtp_action_plan_estado_check", sql`${table.estado} IN ('pendiente', 'en_proceso', 'completado', 'verificado', 'reabierto')`),
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
  activities: many(pdtpActivities),
  changeLog: many(pdtpChangeLog),
  sheets: many(pdtpSheets),
}))

export const pdtpActivitiesRelations = relations(pdtpActivities, ({ one, many }) => ({
  program: one(pdtpPrograms, { fields: [pdtpActivities.programId], references: [pdtpPrograms.id] }),
  schedule: many(pdtpActivitySchedule),
  executions: many(pdtpExecutions),
  sheetMemberships: many(pdtpSheetActivities),
  checklists: many(pdtpActivityChecklists),
}))

export const pdtpActivityScheduleRelations = relations(pdtpActivitySchedule, ({ one }) => ({
  activity: one(pdtpActivities, { fields: [pdtpActivitySchedule.activityId], references: [pdtpActivities.id] }),
}))

export const pdtpExecutionsRelations = relations(pdtpExecutions, ({ one, many }) => ({
  activity: one(pdtpActivities, { fields: [pdtpExecutions.activityId], references: [pdtpActivities.id] }),
  worksite: one(worksites, { fields: [pdtpExecutions.worksiteId], references: [worksites.id] }),
  executedByUser: one(users, { fields: [pdtpExecutions.executedByUserId], references: [users.id] }),
  approvedByUser: one(users, { fields: [pdtpExecutions.approvedByUserId], references: [users.id] }),
  checklistInstance: one(pdtpExecutionChecklists),
  actionPlan: many(pdtpActionPlan),
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

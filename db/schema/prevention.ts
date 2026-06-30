import { relations } from "drizzle-orm"
import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites, workers } from "./worksites"

/* ── IPER/MIPER: Matriz de Identificación de Peligros y Evaluación de Riesgos ── */
// Cabecera de matriz: una matriz por faena + código + versión. Permite versionar
// y cerrar matrices anteriores sin perder trazabilidad. status: 'draft' | 'active' | 'closed'.
export const iperMatrices = pgTable("iper_matrices", {
  id:            text("id").primaryKey(),
  worksiteId:    text("worksite_id").notNull().references(() => worksites.id),
  code:          text("code").notNull(),
  version:       integer("version").notNull(),
  title:         text("title").notNull(),
  status:        text("status").notNull().default("draft"),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo:   text("effective_to"),
  createdBy:     text("created_by").notNull().references(() => users.id),
  closedBy:      text("closed_by").references(() => users.id),
  closedAt:      timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("iper_matrices_code_version_unique").on(table.code, table.version),
  index("iper_matrices_worksite_status_idx").on(table.worksiteId, table.status),
])

// Ítems de riesgo asociados a una matriz. Cada fila representa un peligro evaluado
// con probabilidad x severidad inicial y residual (escala 1..5).
// initialRiskLevel / residualRiskLevel: 'bajo' | 'medio' | 'alto' | 'critico'
// controls: string[] (jerarquía: eliminación, sustitución, ingeniería, administrativo, EPP)
export const iperRiskItems = pgTable("iper_risk_items", {
  id:                  text("id").primaryKey(),
  matrixId:            text("matrix_id").notNull().references(() => iperMatrices.id, { onDelete: "cascade" }),
  process:             text("process").notNull(),
  task:                text("task").notNull(),
  hazard:              text("hazard").notNull(),
  consequence:         text("consequence").notNull(),
  initialProbability:  integer("initial_probability").notNull(),
  initialSeverity:     integer("initial_severity").notNull(),
  initialRiskScore:    integer("initial_risk_score").notNull(),
  initialRiskLevel:    text("initial_risk_level").notNull(),
  controls:            jsonb("controls").notNull(),
  residualProbability: integer("residual_probability").notNull(),
  residualSeverity:    integer("residual_severity").notNull(),
  residualRiskScore:   integer("residual_risk_score").notNull(),
  residualRiskLevel:   text("residual_risk_level").notNull(),
  responsible:         text("responsible").notNull(),
  requiresTraining:    boolean("requires_training").notNull().default(false),
  requiresPpa:         boolean("requires_ppa").notNull().default(false),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("iper_risk_items_matrix_idx").on(table.matrixId),
  index("iper_risk_items_residual_level_idx").on(table.residualRiskLevel),
])

/* ── Accidentes, incidentes y cuasi accidentes ───────────────────────────── */
// Cabecera de evento. type: 'accidente' | 'incidente' | 'cuasi_accidente' | 'enfermedad_profesional'
// status: 'open' | 'investigating' | 'closed'
export const preventionIncidents = pgTable("prevention_incidents", {
  id:             text("id").primaryKey(),
  worksiteId:     text("worksite_id").notNull().references(() => worksites.id),
  workerId:       text("worker_id"),
  type:           text("type").notNull(),
  status:         text("status").notNull().default("open"),
  severity:       text("severity").notNull().default("leve"),
  occurredAt:     timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  title:          text("title").notNull(),
  description:    text("description").notNull(),
  immediateCause: text("immediate_cause"),
  rootCause:      text("root_cause"),
  location:       text("location"),
  createdBy:      text("created_by").notNull().references(() => users.id),
  closedBy:       text("closed_by").references(() => users.id),
  closedAt:       timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("prevention_incidents_worksite_status_idx").on(table.worksiteId, table.status),
  index("prevention_incidents_type_occurred_idx").on(table.type, table.occurredAt),
])

// Acciones correctivas derivadas de la investigación de un incidente.
// status: 'pendiente' | 'en_curso' | 'cerrada' | 'cancelada'
export const preventionIncidentActions = pgTable("prevention_incident_actions", {
  id:          text("id").primaryKey(),
  incidentId:  text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  responsible: text("responsible").notNull(),
  dueDate:     text("due_date").notNull(),
  status:      text("status").notNull().default("pendiente"),
  closedAt:    timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("prevention_incident_actions_incident_status_idx").on(table.incidentId, table.status),
])

/* ── Capacitaciones, competencias y vencimientos ─────────────────────────── */
// Catálogo de cursos (ODI, RIOHS, charla diaria, etc.).
// validityMonths: meses de vigencia una vez completado; null = sin vencimiento.
// requiredForCargo: string[] de CargoKey para alertar bloqueos preventivos.
export const trainingCourses = pgTable("training_courses", {
  id:               text("id").primaryKey(),
  code:             text("code").notNull().unique(),
  name:             text("name").notNull(),
  validityMonths:   integer("validity_months"),
  requiredForCargo: jsonb("required_for_cargo").notNull(),
  isActive:         boolean("is_active").notNull().default(true),
  createdBy:        text("created_by").notNull().references(() => users.id),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

// Asignación de un curso a un trabajador en una faena. completedAt y expiresAt
// como ISO date string ('YYYY-MM-DD'). upsert por (workerId, courseId).
export const workerTrainingAssignments = pgTable("worker_training_assignments", {
  id:          text("id").primaryKey(),
  courseId:    text("course_id").notNull().references(() => trainingCourses.id),
  workerId:    text("worker_id").notNull(),
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  completedAt: text("completed_at").notNull(),
  expiresAt:   text("expires_at"),
  score:       integer("score"),
  evidenceUrl: text("evidence_url"),
  createdBy:   text("created_by").notNull().references(() => users.id),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("worker_training_assignments_worker_idx").on(table.workerId),
  index("worker_training_assignments_worksite_expires_idx").on(table.worksiteId, table.expiresAt),
  uniqueIndex("worker_training_assignments_worker_course_unique").on(table.workerId, table.courseId),
])

/* ── PDTP SG-SST 2026: catálogo, cronograma y bitácora ──────────────────── */
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

/* ── Relations ───────────────────────────────────────────────────────────── */
export const iperMatricesRelations = relations(iperMatrices, ({ one, many }) => ({
  worksite: one(worksites, { fields: [iperMatrices.worksiteId], references: [worksites.id] }),
  creator:  one(users, { fields: [iperMatrices.createdBy], references: [users.id] }),
  items:    many(iperRiskItems),
}))

export const iperRiskItemsRelations = relations(iperRiskItems, ({ one }) => ({
  matrix: one(iperMatrices, { fields: [iperRiskItems.matrixId], references: [iperMatrices.id] }),
}))

export const preventionIncidentsRelations = relations(preventionIncidents, ({ one, many }) => ({
  worksite:    one(worksites, { fields: [preventionIncidents.worksiteId], references: [worksites.id] }),
  worker:      one(workers,   { fields: [preventionIncidents.workerId], references: [workers.id] }),
  createdByUser: one(users,  { fields: [preventionIncidents.createdBy], references: [users.id] }),
  actions:     many(preventionIncidentActions),
}))

export const preventionIncidentActionsRelations = relations(preventionIncidentActions, ({ one }) => ({
  incident: one(preventionIncidents, {
    fields: [preventionIncidentActions.incidentId],
    references: [preventionIncidents.id],
  }),
}))

export const trainingCoursesRelations = relations(trainingCourses, ({ many }) => ({
  assignments: many(workerTrainingAssignments),
}))

export const workerTrainingAssignmentsRelations = relations(workerTrainingAssignments, ({ one }) => ({
  course:    one(trainingCourses, { fields: [workerTrainingAssignments.courseId], references: [trainingCourses.id] }),
  worksite:  one(worksites,        { fields: [workerTrainingAssignments.worksiteId], references: [worksites.id] }),
  worker:    one(workers,          { fields: [workerTrainingAssignments.workerId], references: [workers.id] }),
  createdByUser: one(users,       { fields: [workerTrainingAssignments.createdBy], references: [users.id] }),
}))

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

/* ── Inferred Types ──────────────────────────────────────────────────────── */
export type IperMatrix             = typeof iperMatrices.$inferSelect
export type NewIperMatrix          = typeof iperMatrices.$inferInsert
export type IperRiskItem           = typeof iperRiskItems.$inferSelect
export type NewIperRiskItem        = typeof iperRiskItems.$inferInsert
export type PreventionIncident     = typeof preventionIncidents.$inferSelect
export type NewPreventionIncident  = typeof preventionIncidents.$inferInsert
export type PreventionIncidentAction = typeof preventionIncidentActions.$inferSelect
export type NewPreventionIncidentAction = typeof preventionIncidentActions.$inferInsert
export type TrainingCourse         = typeof trainingCourses.$inferSelect
export type NewTrainingCourse      = typeof trainingCourses.$inferInsert
export type WorkerTrainingAssignment = typeof workerTrainingAssignments.$inferSelect
export type NewWorkerTrainingAssignment = typeof workerTrainingAssignments.$inferInsert
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

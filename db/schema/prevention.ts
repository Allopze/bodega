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

/* ── Inspecciones y observaciones conductuales ──────────────────────────── */
export const inspectionTemplates = pgTable("inspection_templates", {
  id:            text("id").primaryKey(),
  code:          text("code").notNull().unique(),
  title:         text("title").notNull(),
  scope:         text("scope").notNull(),
  items:         jsonb("items").notNull(),
  frequency:     text("frequency").notNull().default("mensual"),
  requiresPhoto: boolean("requires_photo").notNull().default(false),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("inspection_templates_frequency_idx").on(table.frequency),
])

export const inspectionRuns = pgTable("inspection_runs", {
  id:          text("id").primaryKey(),
  templateId:  text("template_id").notNull().references(() => inspectionTemplates.id),
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  inspectorId: text("inspector_id").notNull().references(() => users.id),
  startedAt:   timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  status:      text("status").notNull().default("open"),
  signature:   text("signature"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("inspection_runs_worksite_status_idx").on(table.worksiteId, table.status),
  index("inspection_runs_inspector_idx").on(table.inspectorId),
])

export const inspectionItems = pgTable("inspection_items", {
  id:        text("id").primaryKey(),
  runId:     text("run_id").notNull().references(() => inspectionRuns.id, { onDelete: "cascade" }),
  itemKey:   text("item_key").notNull(),
  expected:  text("expected").notNull(),
  observed:  text("observed"),
  status:    text("status").notNull().default("ok"),
  note:      text("note"),
  photoUrl:  text("photo_url"),
  closedAt:  timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("inspection_items_run_key_unique").on(table.runId, table.itemKey),
  index("inspection_items_status_idx").on(table.status),
])

export const behavioralObservations = pgTable("behavioral_observations", {
  id:                 text("id").primaryKey(),
  worksiteId:         text("worksite_id").notNull().references(() => worksites.id),
  observerId:         text("observer_id").notNull().references(() => users.id),
  workerId:           text("worker_id"),
  antecedent:         text("antecedent").notNull(),
  behavior:           text("behavior").notNull(),
  consequence:        text("consequence").notNull(),
  severity:           text("severity").notNull().default("bajo"),
  runId:              text("run_id").references(() => inspectionRuns.id),
  correctiveActionId: text("corrective_action_id"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("behavioral_observations_worksite_severity_idx").on(table.worksiteId, table.severity),
  index("behavioral_observations_run_idx").on(table.runId),
])

/* ── Reportes operacionales, equipos y alcotest ─────────────────────────── */
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

/* ── Matriz EPP preventiva ─────────────────────────────────────────────── */
export const eppPositionMatrix = pgTable("epp_position_matrix", {
  id:            text("id").primaryKey(),
  worksiteId:    text("worksite_id").notNull().references(() => worksites.id),
  position:      text("position").notNull(),
  eppProductId:  text("epp_product_id").notNull(),
  riskId:        text("risk_id"),
  requiredSince: text("required_since").notNull(),
  notes:         text("notes"),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("epp_position_matrix_ws_pos_prod_unique").on(table.worksiteId, table.position, table.eppProductId),
])

export const eppLifecyclePolicies = pgTable("epp_lifecycle_policies", {
  eppProductId:       text("epp_product_id").primaryKey(),
  lifespanDays:       integer("lifespan_days").notNull(),
  maxReuses:          integer("max_reuses"),
  inspectionChecklist: jsonb("inspection_checklist").notNull(),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export const eppRecambioLog = pgTable("epp_recambio_log", {
  id:           text("id").primaryKey(),
  workerId:     text("worker_id").notNull().references(() => workers.id),
  eppProductId: text("epp_product_id").notNull().references(() => eppLifecyclePolicies.eppProductId),
  deliveredAt:  timestamp("delivered_at", { withTimezone: true, mode: "string" }).notNull(),
  expiresAt:    timestamp("expires_at", { withTimezone: true, mode: "string" }),
  returnedAt:   timestamp("returned_at", { withTimezone: true, mode: "string" }),
  disposition:  text("disposition"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("epp_recambio_log_worker_expires_idx").on(table.workerId, table.expiresAt),
])

export const eppStockThresholds = pgTable("epp_stock_thresholds", {
  id:            text("id").primaryKey(),
  worksiteId:    text("worksite_id").notNull().references(() => worksites.id),
  eppProductId:  text("epp_product_id").notNull(),
  minStock:      integer("min_stock").notNull().default(0),
  criticalStock: integer("critical_stock").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("epp_stock_thresholds_ws_prod_unique").on(table.worksiteId, table.eppProductId),
])

/* ── Permisos de trabajo y AST/ART/JSA ──────────────────────────────────── */
export const permitTemplates = pgTable("permit_templates", {
  id:               text("id").primaryKey(),
  code:             text("code").notNull().unique(),
  title:            text("title").notNull(),
  riskType:         text("risk_type").notNull(),
  astFields:        jsonb("ast_fields").notNull(),
  validityHours:    integer("validity_hours"),
  requiresSignoff:  jsonb("requires_signoff").notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("permit_templates_risk_type_idx").on(table.riskType),
])

export const permitRequests = pgTable("permit_requests", {
  id:            text("id").primaryKey(),
  templateId:    text("template_id").notNull().references(() => permitTemplates.id),
  worksiteId:    text("worksite_id").notNull().references(() => worksites.id),
  requesterId:   text("requester_id").notNull().references(() => users.id),
  task:          text("task").notNull(),
  location:      text("location").notNull(),
  plannedStart:  timestamp("planned_start", { withTimezone: true, mode: "string" }).notNull(),
  plannedEnd:    timestamp("planned_end", { withTimezone: true, mode: "string" }).notNull(),
  ast:           jsonb("ast").notNull(),
  status:        text("status").notNull().default("solicitado"),
  approverId:    text("approver_id").references(() => users.id),
  executorId:    text("executor_id").references(() => users.id),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("permit_requests_ws_status_planned_idx").on(table.worksiteId, table.status, table.plannedStart),
])

export const permitSignoffs = pgTable("permit_signoffs", {
  id:        text("id").primaryKey(),
  permitId:  text("permit_id").notNull().references(() => permitRequests.id, { onDelete: "cascade" }),
  role:      text("role").notNull(),
  userId:    text("user_id").notNull().references(() => users.id),
  signedAt:  timestamp("signed_at", { withTimezone: true, mode: "string" }).notNull(),
  signature: text("signature").notNull(),
}, (table) => [
  uniqueIndex("permit_signoffs_permit_role_unique").on(table.permitId, table.role),
])

export const permitAttachments = pgTable("permit_attachments", {
  id:         text("id").primaryKey(),
  permitId:   text("permit_id").notNull().references(() => permitRequests.id, { onDelete: "cascade" }),
  kind:       text("kind").notNull(),
  url:        text("url").notNull(),
  uploadedBy: text("uploaded_by").notNull().references(() => users.id),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("permit_attachments_permit_kind_idx").on(table.permitId, table.kind),
])

/* ── Relations (Ola 2) ───────────────────────────────────────────────────── */
export const inspectionTemplatesRelations = relations(inspectionTemplates, ({ many }) => ({
  runs: many(inspectionRuns),
}))

export const inspectionRunsRelations = relations(inspectionRuns, ({ one, many }) => ({
  template:  one(inspectionTemplates, { fields: [inspectionRuns.templateId], references: [inspectionTemplates.id] }),
  worksite:  one(worksites, { fields: [inspectionRuns.worksiteId], references: [worksites.id] }),
  inspector: one(users, { fields: [inspectionRuns.inspectorId], references: [users.id] }),
  items:     many(inspectionItems),
  observations: many(behavioralObservations),
}))

export const inspectionItemsRelations = relations(inspectionItems, ({ one }) => ({
  run: one(inspectionRuns, { fields: [inspectionItems.runId], references: [inspectionRuns.id] }),
}))

export const behavioralObservationsRelations = relations(behavioralObservations, ({ one }) => ({
  worksite: one(worksites, { fields: [behavioralObservations.worksiteId], references: [worksites.id] }),
  observer: one(users, { fields: [behavioralObservations.observerId], references: [users.id] }),
  worker:   one(workers, { fields: [behavioralObservations.workerId], references: [workers.id] }),
  run:      one(inspectionRuns, { fields: [behavioralObservations.runId], references: [inspectionRuns.id] }),
}))

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

export const eppPositionMatrixRelations = relations(eppPositionMatrix, ({ one }) => ({
  worksite: one(worksites, { fields: [eppPositionMatrix.worksiteId], references: [worksites.id] }),
}))

export const eppRecambioLogRelations = relations(eppRecambioLog, ({ one }) => ({
  worker:   one(workers, { fields: [eppRecambioLog.workerId], references: [workers.id] }),
  product:  one(eppLifecyclePolicies, { fields: [eppRecambioLog.eppProductId], references: [eppLifecyclePolicies.eppProductId] }),
}))

export const eppStockThresholdsRelations = relations(eppStockThresholds, ({ one }) => ({
  worksite: one(worksites, { fields: [eppStockThresholds.worksiteId], references: [worksites.id] }),
}))

export const permitTemplatesRelations = relations(permitTemplates, ({ many }) => ({
  requests: many(permitRequests),
}))

export const permitRequestsRelations = relations(permitRequests, ({ one, many }) => ({
  template:  one(permitTemplates, { fields: [permitRequests.templateId], references: [permitTemplates.id] }),
  worksite:  one(worksites, { fields: [permitRequests.worksiteId], references: [worksites.id] }),
  requester: one(users, { fields: [permitRequests.requesterId], references: [users.id] }),
  approver:  one(users, { fields: [permitRequests.approverId], references: [users.id] }),
  executor:  one(users, { fields: [permitRequests.executorId], references: [users.id] }),
  signoffs:  many(permitSignoffs),
  attachments: many(permitAttachments),
}))

export const permitSignoffsRelations = relations(permitSignoffs, ({ one }) => ({
  permit: one(permitRequests, { fields: [permitSignoffs.permitId], references: [permitRequests.id] }),
  user:   one(users, { fields: [permitSignoffs.userId], references: [users.id] }),
}))

export const permitAttachmentsRelations = relations(permitAttachments, ({ one }) => ({
  permit:    one(permitRequests, { fields: [permitAttachments.permitId], references: [permitRequests.id] }),
  uploader:  one(users, { fields: [permitAttachments.uploadedBy], references: [users.id] }),
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
export type InspectionTemplate = typeof inspectionTemplates.$inferSelect
export type NewInspectionTemplate = typeof inspectionTemplates.$inferInsert
export type InspectionRun = typeof inspectionRuns.$inferSelect
export type NewInspectionRun = typeof inspectionRuns.$inferInsert
export type InspectionItem = typeof inspectionItems.$inferSelect
export type NewInspectionItem = typeof inspectionItems.$inferInsert
export type BehavioralObservation = typeof behavioralObservations.$inferSelect
export type NewBehavioralObservation = typeof behavioralObservations.$inferInsert
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
export type EppPositionEntry = typeof eppPositionMatrix.$inferSelect
export type NewEppPositionEntry = typeof eppPositionMatrix.$inferInsert
export type EppLifecyclePolicy = typeof eppLifecyclePolicies.$inferSelect
export type NewEppLifecyclePolicy = typeof eppLifecyclePolicies.$inferInsert
export type EppRecambioEntry = typeof eppRecambioLog.$inferSelect
export type NewEppRecambioEntry = typeof eppRecambioLog.$inferInsert
export type EppStockThreshold = typeof eppStockThresholds.$inferSelect
export type NewEppStockThreshold = typeof eppStockThresholds.$inferInsert
export type PermitTemplate = typeof permitTemplates.$inferSelect
export type NewPermitTemplate = typeof permitTemplates.$inferInsert
export type PermitRequest = typeof permitRequests.$inferSelect
export type NewPermitRequest = typeof permitRequests.$inferInsert
export type PermitSignoff = typeof permitSignoffs.$inferSelect
export type NewPermitSignoff = typeof permitSignoffs.$inferInsert
export type PermitAttachment = typeof permitAttachments.$inferSelect
export type NewPermitAttachment = typeof permitAttachments.$inferInsert

/* ── Salud ocupacional y protocolos MINSAL (Ola 3) ─────────────────────── */
export const healthExams = pgTable("health_exams", {
  id:          text("id").primaryKey(),
  workerId:    text("worker_id").notNull().references(() => workers.id),
  type:        text("type").notNull(),
  protocolId:  text("protocol_id"),
  performedAt: text("performed_at").notNull(),
  result:      text("result").notNull().default("pendiente"),
  expiresAt:   text("expires_at"),
  evidenceUrl: text("evidence_url"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("health_exams_worker_type_expires_idx").on(table.workerId, table.type, table.expiresAt),
])

export const healthAptitudes = pgTable("health_aptitudes", {
  id:           text("id").primaryKey(),
  workerId:     text("worker_id").notNull().references(() => workers.id),
  examId:       text("exam_id").references(() => healthExams.id),
  position:     text("position").notNull(),
  aptitude:     text("aptitude").notNull(),
  restrictions: jsonb("restrictions").notNull(),
  validUntil:   text("valid_until"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("health_aptitudes_worker_position_valid_idx").on(table.workerId, table.position, table.validUntil),
])

export const healthRestrictions = pgTable("health_restrictions", {
  id:            text("id").primaryKey(),
  workerId:      text("worker_id").notNull().references(() => workers.id),
  kind:          text("kind").notNull(),
  description:   text("description").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo:   text("effective_to"),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("health_restrictions_worker_to_idx").on(table.workerId, table.effectiveTo),
])

export const minsalProtocols = pgTable("minsal_protocols", {
  id:                   text("id").primaryKey(),
  code:                 text("code").notNull().unique(),
  name:                 text("name").notNull(),
  legalFramework:       text("legal_framework").notNull(),
  appliesToPositions:   jsonb("applies_to_positions").notNull(),
  periodicityMonths:    integer("periodicity_months").notNull(),
  createdAt:            timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:            timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export const protocolApplications = pgTable("protocol_applications", {
  id:                  text("id").primaryKey(),
  workerId:             text("worker_id").notNull().references(() => workers.id),
  protocolId:           text("protocol_id").notNull().references(() => minsalProtocols.id),
  startedAt:            text("started_at").notNull(),
  lastEvaluationAt:     text("last_evaluation_at"),
  nextDueAt:            text("next_due_at"),
  status:               text("status").notNull().default("vigente"),
  createdAt:            timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:            timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("protocol_applications_worker_protocol_unique").on(table.workerId, table.protocolId),
  index("protocol_applications_due_idx").on(table.nextDueAt, table.status),
])

/* ── Emergencias y CGRD (Ola 3) ────────────────────────────────────────── */
export const emergencyPlans = pgTable("emergency_plans", {
  id:          text("id").primaryKey(),
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  version:     integer("version").notNull(),
  threats:     jsonb("threats").notNull(),
  roles:       jsonb("roles").notNull(),
  routes:      jsonb("routes").notNull(),
  approvedBy:  text("approved_by").references(() => users.id),
  approvedAt:  timestamp("approved_at", { withTimezone: true, mode: "string" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("emergency_plans_ws_version_unique").on(table.worksiteId, table.version),
])

export const emergencyDrills = pgTable("emergency_drills", {
  id:           text("id").primaryKey(),
  planId:       text("plan_id").notNull().references(() => emergencyPlans.id),
  type:         text("type").notNull(),
  scheduledAt:  timestamp("scheduled_at", { withTimezone: true, mode: "string" }).notNull(),
  executedAt:   timestamp("executed_at", { withTimezone: true, mode: "string" }),
  attendees:    integer("attendees"),
  findings:     jsonb("findings").notNull(),
  effectiveness: text("effectiveness"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("emergency_drills_plan_scheduled_idx").on(table.planId, table.scheduledAt),
])

export const emergencyTeams = pgTable("emergency_teams", {
  id:         text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id),
  name:       text("name").notNull(),
  leaderId:   text("leader_id").notNull().references(() => users.id),
  members:    jsonb("members").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("emergency_teams_ws_name_unique").on(table.worksiteId, table.name),
])

export const emergencyEquipment = pgTable("emergency_equipment", {
  id:                text("id").primaryKey(),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id),
  kind:              text("kind").notNull(),
  code:              text("code").notNull(),
  location:          text("location").notNull(),
  lastInspectionAt:  timestamp("last_inspection_at", { withTimezone: true, mode: "string" }),
  nextInspectionAt:  timestamp("next_inspection_at", { withTimezone: true, mode: "string" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("emergency_equipment_ws_kind_code_unique").on(table.worksiteId, table.kind, table.code),
])

export const equipmentInspections = pgTable("equipment_inspections", {
  id:          text("id").primaryKey(),
  equipmentId: text("equipment_id").notNull().references(() => emergencyEquipment.id),
  performedAt: timestamp("performed_at", { withTimezone: true, mode: "string" }).notNull(),
  performedBy: text("performed_by").notNull().references(() => users.id),
  status:      text("status").notNull().default("vigente"),
  findings:    jsonb("findings").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("equipment_inspections_equip_date_idx").on(table.equipmentId, table.performedAt),
])

/* ── Documentación legal (Ola 4) ────────────────────────────────────────── */
export const legalDocuments = pgTable("legal_documents", {
  id:                text("id").primaryKey(),
  type:              text("type").notNull(),
  code:              text("code").notNull(),
  title:             text("title").notNull(),
  currentVersionId:  text("current_version_id"),
  mandatory:         boolean("mandatory").notNull().default(true),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("legal_documents_type_code_unique").on(table.type, table.code),
])

export const legalDocumentVersions = pgTable("legal_document_versions", {
  id:            text("id").primaryKey(),
  documentId:    text("document_id").notNull().references(() => legalDocuments.id, { onDelete: "cascade" }),
  version:       integer("version").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo:   text("effective_to"),
  fileUrl:       text("file_url"),
  changelog:     text("changelog"),
  signedBy:      text("signed_by").references(() => users.id),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("legal_document_versions_doc_version_unique").on(table.documentId, table.version),
])

export const documentDeliveries = pgTable("document_deliveries", {
  id:              text("id").primaryKey(),
  versionId:       text("version_id").notNull().references(() => legalDocumentVersions.id),
  workerId:        text("worker_id").notNull().references(() => workers.id),
  deliveredAt:     timestamp("delivered_at", { withTimezone: true, mode: "string" }).notNull(),
  method:          text("method").notNull().default("digital"),
  evidenceUrl:     text("evidence_url"),
  acknowledgedAt:  timestamp("acknowledged_at", { withTimezone: true, mode: "string" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("document_deliveries_version_worker_unique").on(table.versionId, table.workerId),
])

export const documentSignatures = pgTable("document_signatures", {
  id:         text("id").primaryKey(),
  deliveryId: text("delivery_id").notNull().references(() => documentDeliveries.id, { onDelete: "cascade" }),
  userId:     text("user_id").notNull().references(() => users.id),
  signature:  text("signature").notNull(),
  signedAt:   timestamp("signed_at", { withTimezone: true, mode: "string" }).notNull(),
  ip:         text("ip"),
}, (table) => [
  uniqueIndex("document_signatures_delivery_user_unique").on(table.deliveryId, table.userId),
])

/* ── Contratistas (Ola 4) ──────────────────────────────────────────────── */
export const contractors = pgTable("contractors", {
  id:                 text("id").primaryKey(),
  rut:                text("rut").notNull().unique(),
  name:               text("name").notNull(),
  legalRepresentative: text("legal_representative"),
  contact:            text("contact"),
  status:             text("status").notNull().default("activo"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export const contractorWorkers = pgTable("contractor_workers", {
  id:           text("id").primaryKey(),
  contractorId: text("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  workerId:     text("worker_id").notNull().references(() => workers.id),
  position:     text("position").notNull(),
  startDate:    text("start_date").notNull(),
  endDate:      text("end_date"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("contractor_workers_contractor_end_idx").on(table.contractorId, table.endDate),
])

export const contractorDocuments = pgTable("contractor_documents", {
  id:           text("id").primaryKey(),
  contractorId: text("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  type:         text("type").notNull(),
  versionId:    text("version_id"),
  status:       text("status").notNull().default("pendiente"),
  expiresAt:    text("expires_at"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("contractor_documents_contractor_type_expires_idx").on(table.contractorId, table.type, table.expiresAt),
])

/* ── Comités y reuniones (Ola 4) ────────────────────────────────────────── */
export const committees = pgTable("committees", {
  id:         text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id),
  type:       text("type").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  status:     text("status").notNull().default("activo"),
}, (table) => [
  uniqueIndex("committees_ws_type_unique").on(table.worksiteId, table.type),
])

export const committeeMembers = pgTable("committee_members", {
  id:          text("id").primaryKey(),
  committeeId: text("committee_id").notNull().references(() => committees.id, { onDelete: "cascade" }),
  userId:      text("user_id").notNull().references(() => users.id),
  role:        text("role").notNull(),
  startDate:   text("start_date").notNull(),
  endDate:     text("end_date"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("committee_members_committee_user_unique").on(table.committeeId, table.userId),
])

export const committeeMeetings = pgTable("committee_meetings", {
  id:          text("id").primaryKey(),
  committeeId: text("committee_id").notNull().references(() => committees.id, { onDelete: "cascade" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "string" }).notNull(),
  heldAt:      timestamp("held_at", { withTimezone: true, mode: "string" }),
  attendees:   jsonb("attendees").notNull(),
  agenda:      text("agenda").notNull(),
  minutesUrl:  text("minutes_url"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("committee_meetings_committee_scheduled_idx").on(table.committeeId, table.scheduledAt),
])

export const committeeAgreements = pgTable("committee_agreements", {
  id:            text("id").primaryKey(),
  meetingId:     text("meeting_id").notNull().references(() => committeeMeetings.id, { onDelete: "cascade" }),
  description:   text("description").notNull(),
  responsibleId: text("responsible_id").notNull().references(() => users.id),
  dueDate:       text("due_date").notNull(),
  status:        text("status").notNull().default("pendiente"),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("committee_agreements_meeting_status_idx").on(table.meetingId, table.status),
])

/* ── KPIs preventivos (Ola 4) ──────────────────────────────────────────── */
export const kpiSnapshots = pgTable("kpi_snapshots", {
  id:         text("id").primaryKey(),
  worksiteId: text("worksite_id"),
  period:     text("period").notNull(),
  metric:     text("metric").notNull(),
  value:      numeric("value", { precision: 15, scale: 4, mode: "number" }).notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true, mode: "string" }).notNull(),
  source:     text("source").notNull(),
}, (table) => [
  uniqueIndex("kpi_snapshots_ws_period_metric_unique").on(table.worksiteId, table.period, table.metric),
  index("kpi_snapshots_period_idx").on(table.period),
])

export const laborHours = pgTable("labor_hours", {
  id:         text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id),
  period:     text("period").notNull(),
  hours:      numeric("hours", { precision: 12, scale: 2, mode: "number" }).notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("labor_hours_ws_period_unique").on(table.worksiteId, table.period),
])

/* ── Procedimiento completo de incidentes (Ola 4) ───────────────────────── */
export const incidentNotifications = pgTable("incident_notifications", {
  id:            text("id").primaryKey(),
  incidentId:    text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  kind:          text("kind").notNull(),
  recipientRole: text("recipient_role").notNull(),
  sentByUserId:  text("sent_by_user_id").notNull().references(() => users.id),
  sentAt:        timestamp("sent_at", { withTimezone: true, mode: "string" }).notNull(),
  deadlineAt:    timestamp("deadline_at", { withTimezone: true, mode: "string" }),
  channel:       text("channel").notNull().default("email"),
  evidenceUrl:   text("evidence_url"),
}, (table) => [
  uniqueIndex("incident_notifications_incident_kind_role_unique").on(table.incidentId, table.kind, table.recipientRole),
  index("incident_notifications_deadline_sent_idx").on(table.deadlineAt, table.sentAt),
])

export const incidentStatements = pgTable("incident_statements", {
  id:            text("id").primaryKey(),
  incidentId:    text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  workerId:      text("worker_id").references(() => workers.id),
  statementType: text("statement_type").notNull(),
  takenByUserId: text("taken_by_user_id").notNull().references(() => users.id),
  takenAt:       timestamp("taken_at", { withTimezone: true, mode: "string" }).notNull(),
  fileUrl:       text("file_url"),
  summary:       text("summary"),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("incident_statements_incident_taken_idx").on(table.incidentId, table.takenAt),
])

export const incidentInvestigations = pgTable("incident_investigations", {
  id:             text("id").primaryKey(),
  incidentId:     text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  startedAt:      timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
  dueAt:          timestamp("due_at", { withTimezone: true, mode: "string" }).notNull(),
  completedAt:    timestamp("completed_at", { withTimezone: true, mode: "string" }),
  method:         text("method").notNull().default("arbol_causal"),
  participants:   jsonb("participants").notNull(),
  rootCauses:     jsonb("root_causes").notNull(),
  finalReportUrl: text("final_report_url"),
  status:         text("status").notNull().default("en_curso"),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("incident_investigations_incident_unique").on(table.incidentId),
])

export const incidentCorrectiveFollowups = pgTable("incident_corrective_followups", {
  id:                text("id").primaryKey(),
  incidentId:        text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  actionId:          text("action_id"),
  responsibleUserId: text("responsible_user_id").notNull().references(() => users.id),
  dueDate:           text("due_date").notNull(),
  status:            text("status").notNull().default("pendiente"),
  closedAt:          timestamp("closed_at", { withTimezone: true, mode: "string" }),
  evidenceUrl:       text("evidence_url"),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("incident_corrective_followups_incident_status_idx").on(table.incidentId, table.status),
  index("incident_corrective_followups_due_status_idx").on(table.dueDate, table.status),
])

export const incidentDisseminations = pgTable("incident_disseminations", {
  id:                text("id").primaryKey(),
  incidentId:        text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  kind:              text("kind").notNull(),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id),
  performedByUserId: text("performed_by_user_id").notNull().references(() => users.id),
  performedAt:       timestamp("performed_at", { withTimezone: true, mode: "string" }).notNull(),
  attendanceUrl:     text("attendance_url"),
  contentUrl:        text("content_url"),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("incident_disseminations_incident_performed_idx").on(table.incidentId, table.performedAt),
])

/* ── Relations (Ola 3 + 4) ──────────────────────────────────────────────── */
export const healthExamsRelations = relations(healthExams, ({ one }) => ({
  worker: one(workers, { fields: [healthExams.workerId], references: [workers.id] }),
}))

export const healthAptitudesRelations = relations(healthAptitudes, ({ one }) => ({
  worker: one(workers, { fields: [healthAptitudes.workerId], references: [workers.id] }),
  exam:   one(healthExams, { fields: [healthAptitudes.examId], references: [healthExams.id] }),
}))

export const healthRestrictionsRelations = relations(healthRestrictions, ({ one }) => ({
  worker: one(workers, { fields: [healthRestrictions.workerId], references: [workers.id] }),
}))

export const minsalProtocolsRelations = relations(minsalProtocols, ({ many }) => ({
  applications: many(protocolApplications),
}))

export const protocolApplicationsRelations = relations(protocolApplications, ({ one }) => ({
  worker:   one(workers, { fields: [protocolApplications.workerId], references: [workers.id] }),
  protocol: one(minsalProtocols, { fields: [protocolApplications.protocolId], references: [minsalProtocols.id] }),
}))

export const emergencyPlansRelations = relations(emergencyPlans, ({ one, many }) => ({
  worksite:  one(worksites, { fields: [emergencyPlans.worksiteId], references: [worksites.id] }),
  approver:  one(users, { fields: [emergencyPlans.approvedBy], references: [users.id] }),
  drills:    many(emergencyDrills),
}))

export const emergencyDrillsRelations = relations(emergencyDrills, ({ one }) => ({
  plan: one(emergencyPlans, { fields: [emergencyDrills.planId], references: [emergencyPlans.id] }),
}))

export const emergencyTeamsRelations = relations(emergencyTeams, ({ one }) => ({
  worksite: one(worksites, { fields: [emergencyTeams.worksiteId], references: [worksites.id] }),
  leader:   one(users, { fields: [emergencyTeams.leaderId], references: [users.id] }),
}))

export const emergencyEquipmentRelations = relations(emergencyEquipment, ({ one, many }) => ({
  worksite:    one(worksites, { fields: [emergencyEquipment.worksiteId], references: [worksites.id] }),
  inspections: many(equipmentInspections),
}))

export const equipmentInspectionsRelations = relations(equipmentInspections, ({ one }) => ({
  equipment:  one(emergencyEquipment, { fields: [equipmentInspections.equipmentId], references: [emergencyEquipment.id] }),
  performedByUser: one(users, { fields: [equipmentInspections.performedBy], references: [users.id] }),
}))

export const legalDocumentsRelations = relations(legalDocuments, ({ many }) => ({
  versions: many(legalDocumentVersions),
}))

export const legalDocumentVersionsRelations = relations(legalDocumentVersions, ({ one, many }) => ({
  document:   one(legalDocuments, { fields: [legalDocumentVersions.documentId], references: [legalDocuments.id] }),
  signer:     one(users, { fields: [legalDocumentVersions.signedBy], references: [users.id] }),
  deliveries: many(documentDeliveries),
}))

export const documentDeliveriesRelations = relations(documentDeliveries, ({ one, many }) => ({
  version:     one(legalDocumentVersions, { fields: [documentDeliveries.versionId], references: [legalDocumentVersions.id] }),
  worker:      one(workers, { fields: [documentDeliveries.workerId], references: [workers.id] }),
  signatures:  many(documentSignatures),
}))

export const documentSignaturesRelations = relations(documentSignatures, ({ one }) => ({
  delivery: one(documentDeliveries, { fields: [documentSignatures.deliveryId], references: [documentDeliveries.id] }),
  user:     one(users, { fields: [documentSignatures.userId], references: [users.id] }),
}))

export const contractorsRelations = relations(contractors, ({ many }) => ({
  workers:   many(contractorWorkers),
  documents: many(contractorDocuments),
}))

export const contractorWorkersRelations = relations(contractorWorkers, ({ one }) => ({
  contractor: one(contractors, { fields: [contractorWorkers.contractorId], references: [contractors.id] }),
  worker:     one(workers, { fields: [contractorWorkers.workerId], references: [workers.id] }),
}))

export const contractorDocumentsRelations = relations(contractorDocuments, ({ one }) => ({
  contractor: one(contractors, { fields: [contractorDocuments.contractorId], references: [contractors.id] }),
}))

export const committeesRelations = relations(committees, ({ one, many }) => ({
  worksite: one(worksites, { fields: [committees.worksiteId], references: [worksites.id] }),
  members:  many(committeeMembers),
  meetings: many(committeeMeetings),
}))

export const committeeMembersRelations = relations(committeeMembers, ({ one }) => ({
  committee: one(committees, { fields: [committeeMembers.committeeId], references: [committees.id] }),
  user:      one(users, { fields: [committeeMembers.userId], references: [users.id] }),
}))

export const committeeMeetingsRelations = relations(committeeMeetings, ({ one, many }) => ({
  committee:  one(committees, { fields: [committeeMeetings.committeeId], references: [committees.id] }),
  agreements: many(committeeAgreements),
}))

export const committeeAgreementsRelations = relations(committeeAgreements, ({ one }) => ({
  meeting:     one(committeeMeetings, { fields: [committeeAgreements.meetingId], references: [committeeMeetings.id] }),
  responsible: one(users, { fields: [committeeAgreements.responsibleId], references: [users.id] }),
}))

export const kpiSnapshotsRelations = relations(kpiSnapshots, ({ one }) => ({
  worksite: one(worksites, { fields: [kpiSnapshots.worksiteId], references: [worksites.id] }),
}))

export const laborHoursRelations = relations(laborHours, ({ one }) => ({
  worksite: one(worksites, { fields: [laborHours.worksiteId], references: [worksites.id] }),
}))

export const incidentNotificationsRelations = relations(incidentNotifications, ({ one }) => ({
  incident:   one(preventionIncidents, { fields: [incidentNotifications.incidentId], references: [preventionIncidents.id] }),
  sentByUser: one(users, { fields: [incidentNotifications.sentByUserId], references: [users.id] }),
}))

export const incidentStatementsRelations = relations(incidentStatements, ({ one }) => ({
  incident:    one(preventionIncidents, { fields: [incidentStatements.incidentId], references: [preventionIncidents.id] }),
  worker:      one(workers, { fields: [incidentStatements.workerId], references: [workers.id] }),
  takenByUser: one(users, { fields: [incidentStatements.takenByUserId], references: [users.id] }),
}))

export const incidentInvestigationsRelations = relations(incidentInvestigations, ({ one }) => ({
  incident: one(preventionIncidents, { fields: [incidentInvestigations.incidentId], references: [preventionIncidents.id] }),
}))

export const incidentCorrectiveFollowupsRelations = relations(incidentCorrectiveFollowups, ({ one }) => ({
  incident:   one(preventionIncidents, { fields: [incidentCorrectiveFollowups.incidentId], references: [preventionIncidents.id] }),
  responsible: one(users, { fields: [incidentCorrectiveFollowups.responsibleUserId], references: [users.id] }),
}))

export const incidentDisseminationsRelations = relations(incidentDisseminations, ({ one }) => ({
  incident: one(preventionIncidents, { fields: [incidentDisseminations.incidentId], references: [preventionIncidents.id] }),
  worksite: one(worksites, { fields: [incidentDisseminations.worksiteId], references: [worksites.id] }),
  performedByUser: one(users, { fields: [incidentDisseminations.performedByUserId], references: [users.id] }),
}))

/* ── Inferred Types (Ola 3 + 4) ─────────────────────────────────────────── */
export type HealthExam = typeof healthExams.$inferSelect
export type NewHealthExam = typeof healthExams.$inferInsert
export type HealthAptitude = typeof healthAptitudes.$inferSelect
export type NewHealthAptitude = typeof healthAptitudes.$inferInsert
export type HealthRestriction = typeof healthRestrictions.$inferSelect
export type NewHealthRestriction = typeof healthRestrictions.$inferInsert
export type MinsalProtocol = typeof minsalProtocols.$inferSelect
export type NewMinsalProtocol = typeof minsalProtocols.$inferInsert
export type ProtocolApplication = typeof protocolApplications.$inferSelect
export type NewProtocolApplication = typeof protocolApplications.$inferInsert
export type EmergencyPlan = typeof emergencyPlans.$inferSelect
export type NewEmergencyPlan = typeof emergencyPlans.$inferInsert
export type EmergencyDrill = typeof emergencyDrills.$inferSelect
export type NewEmergencyDrill = typeof emergencyDrills.$inferInsert
export type EmergencyTeam = typeof emergencyTeams.$inferSelect
export type NewEmergencyTeam = typeof emergencyTeams.$inferInsert
export type EmergencyEquipment = typeof emergencyEquipment.$inferSelect
export type NewEmergencyEquipment = typeof emergencyEquipment.$inferInsert
export type EquipmentInspection = typeof equipmentInspections.$inferSelect
export type NewEquipmentInspection = typeof equipmentInspections.$inferInsert
export type LegalDocument = typeof legalDocuments.$inferSelect
export type NewLegalDocument = typeof legalDocuments.$inferInsert
export type LegalDocumentVersion = typeof legalDocumentVersions.$inferSelect
export type NewLegalDocumentVersion = typeof legalDocumentVersions.$inferInsert
export type DocumentDelivery = typeof documentDeliveries.$inferSelect
export type NewDocumentDelivery = typeof documentDeliveries.$inferInsert
export type DocumentSignature = typeof documentSignatures.$inferSelect
export type NewDocumentSignature = typeof documentSignatures.$inferInsert
export type Contractor = typeof contractors.$inferSelect
export type NewContractor = typeof contractors.$inferInsert
export type ContractorWorker = typeof contractorWorkers.$inferSelect
export type NewContractorWorker = typeof contractorWorkers.$inferInsert
export type ContractorDocument = typeof contractorDocuments.$inferSelect
export type NewContractorDocument = typeof contractorDocuments.$inferInsert
export type Committee = typeof committees.$inferSelect
export type NewCommittee = typeof committees.$inferInsert
export type CommitteeMember = typeof committeeMembers.$inferSelect
export type NewCommitteeMember = typeof committeeMembers.$inferInsert
export type CommitteeMeeting = typeof committeeMeetings.$inferSelect
export type NewCommitteeMeeting = typeof committeeMeetings.$inferInsert
export type CommitteeAgreement = typeof committeeAgreements.$inferSelect
export type NewCommitteeAgreement = typeof committeeAgreements.$inferInsert
export type KpiSnapshot = typeof kpiSnapshots.$inferSelect
export type NewKpiSnapshot = typeof kpiSnapshots.$inferInsert
export type LaborHours = typeof laborHours.$inferSelect
export type NewLaborHours = typeof laborHours.$inferInsert
export type IncidentNotification = typeof incidentNotifications.$inferSelect
export type NewIncidentNotification = typeof incidentNotifications.$inferInsert
export type IncidentStatement = typeof incidentStatements.$inferSelect
export type NewIncidentStatement = typeof incidentStatements.$inferInsert
export type IncidentInvestigation = typeof incidentInvestigations.$inferSelect
export type NewIncidentInvestigation = typeof incidentInvestigations.$inferInsert
export type IncidentCorrectiveFollowup = typeof incidentCorrectiveFollowups.$inferSelect
export type NewIncidentCorrectiveFollowup = typeof incidentCorrectiveFollowups.$inferInsert
export type IncidentDissemination = typeof incidentDisseminations.$inferSelect
export type NewIncidentDissemination = typeof incidentDisseminations.$inferInsert

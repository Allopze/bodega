import { relations } from "drizzle-orm"
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
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
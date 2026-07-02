import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites, workers } from "../worksites"

export const preventionIncidents = pgTable("prevention_incidents", {
  id:             text("id").primaryKey(),
  worksiteId:     text("worksite_id").notNull().references(() => worksites.id),
  workerId:       text("worker_id").references(() => workers.id),
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
  check("prevention_incidents_type_valid", sql`${table.type} IN ('accidente', 'incidente', 'cuasi_accidente', 'enfermedad_profesional')`),
  check("prevention_incidents_status_valid", sql`${table.status} IN ('open', 'investigating', 'closed')`),
  check("prevention_incidents_severity_valid", sql`${table.severity} IN ('leve', 'moderado', 'grave', 'fatal')`),
])

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
  check("prevention_incident_actions_status_valid", sql`${table.status} IN ('pendiente', 'en_curso', 'cerrada', 'cancelada')`),
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

/* ── Relations ───────────────────────────────────────────────────────────── */
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

/* ── Types ───────────────────────────────────────────────────────────────── */
export type PreventionIncident     = typeof preventionIncidents.$inferSelect
export type NewPreventionIncident  = typeof preventionIncidents.$inferInsert
export type PreventionIncidentAction = typeof preventionIncidentActions.$inferSelect
export type NewPreventionIncidentAction = typeof preventionIncidentActions.$inferInsert
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

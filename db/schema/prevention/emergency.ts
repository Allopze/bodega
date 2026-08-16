import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { workers, worksites } from "../worksites"
import { preventionCapaActions } from "./capa"

/* ── Plan de emergencia por faena ─────────────────────────────────────────
 * DS 44 arts. 18-19: cada faena requiere un plan de emergencia vigente,
 * versionado y aprobado, no un documento suelto. Aprobar exige que el plan
 * ya declare al menos un escenario y un rol del organigrama de emergencia
 * (assessPlanReadiness) — un plan sin eso no es un plan operable.
 */
export const preventionEmergencyPlans = pgTable("prevention_emergency_plans", {
  id:              text("id").primaryKey(),
  worksiteId:      text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  code:            text("code").notNull().unique(),
  title:           text("title").notNull(),
  status:          text("status").notNull().default("draft"),
  description:     text("description"),
  approvedByUserId: text("approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  approvedAt:      timestamp("approved_at", { withTimezone: true, mode: "string" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  /** Números de actividad PDTP (campo `n`) que los simulacros de este plan
   * acreditan al completarse. Null = no vinculado al PDTP. */
  pdtpActivityNumbers: jsonb("pdtp_activity_numbers").$type<number[]>(),
  version:         integer("version").notNull().default(1),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Una faena puede tener planes archivados de versiones anteriores, pero
  // sólo un plan vigente (draft o approved) a la vez.
  uniqueIndex("prevention_emergency_plan_active_worksite_unique").on(table.worksiteId)
    .where(sql`${table.status} <> 'archived'`),
  check("prevention_emergency_plan_status_valid", sql`${table.status} IN ('draft', 'approved', 'archived')`),
  check("prevention_emergency_plan_approved_consistent", sql`(${table.status} <> 'approved') OR (${table.approvedByUserId} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)`),
  check("prevention_emergency_plan_version_positive", sql`${table.version} >= 1`),
])

export const preventionEmergencyScenarios = pgTable("prevention_emergency_scenarios", {
  id:                text("id").primaryKey(),
  planId:            text("plan_id").notNull().references(() => preventionEmergencyPlans.id, { onDelete: "cascade" }),
  type:              text("type").notNull(),
  title:             text("title").notNull(),
  description:       text("description"),
  responseProcedure: text("response_procedure").notNull(),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_emergency_scenario_plan_idx").on(table.planId),
  check("prevention_emergency_scenario_type_valid", sql`${table.type} IN ('incendio', 'derrame', 'fuga', 'volcamiento', 'exposicion', 'rescate', 'sismo', 'clima', 'otro')`),
])

/* ── Organigrama de emergencia ─────────────────────────────────────────────
 * Rol operativo con titular y reemplazo. No es el organigrama de la empresa:
 * es específico a la respuesta de emergencia de ese plan.
 */
export const preventionEmergencyRoles = pgTable("prevention_emergency_roles", {
  id:             text("id").primaryKey(),
  planId:         text("plan_id").notNull().references(() => preventionEmergencyPlans.id, { onDelete: "cascade" }),
  roleName:       text("role_name").notNull(),
  assigneeWorkerId: text("assignee_worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  backupWorkerId: text("backup_worker_id").references(() => workers.id, { onDelete: "restrict" }),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_emergency_role_plan_idx").on(table.planId),
])

/* ── Inventario de equipos de emergencia ──────────────────────────────────
 * Extintores, botiquines, camillas, desfibriladores (DS 594).
 *
 * El equipo pertenece a la FAENA, no al documento: colgaba de `planId` con
 * `onDelete: cascade`, así que archivar un plan y emitir el siguiente borraba
 * el inventario entero. Ahora `worksiteId` es la pertenencia real y `planId`
 * queda como referencia opcional al plan que lo declara.
 *
 * `expiresAt` no es lo mismo que `nextInspectionAt`: la carga de un extintor y
 * la caducidad de un botiquín vencen aunque la inspección esté al día.
 */
export const preventionEmergencyResources = pgTable("prevention_emergency_resources", {
  id:               text("id").primaryKey(),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  planId:           text("plan_id").references(() => preventionEmergencyPlans.id, { onDelete: "set null" }),
  name:             text("name").notNull(),
  kind:             text("kind").notNull(),
  location:         text("location").notNull(),
  serialNumber:     text("serial_number"),
  lastInspectedAt:  text("last_inspected_at"),
  nextInspectionAt: text("next_inspection_at"),
  /** Vencimiento del equipo (carga, caducidad), distinto de su inspección. */
  expiresAt:        text("expires_at"),
  status:           text("status").notNull().default("operational"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_emergency_resource_plan_idx").on(table.planId),
  index("prevention_emergency_resource_worksite_idx").on(table.worksiteId),
  // Para la bandeja de vencidos: se consulta por fecha, no por faena.
  index("prevention_emergency_resource_due_idx").on(table.nextInspectionAt),
  index("prevention_emergency_resource_expiry_idx").on(table.expiresAt),
  check("prevention_emergency_resource_status_valid", sql`${table.status} IN ('operational', 'needs_maintenance', 'out_of_service')`),
])

export const preventionEmergencyContacts = pgTable("prevention_emergency_contacts", {
  id:        text("id").primaryKey(),
  planId:    text("plan_id").notNull().references(() => preventionEmergencyPlans.id, { onDelete: "cascade" }),
  name:      text("name").notNull(),
  org:       text("org").notNull(),
  role:      text("role"),
  phone:     text("phone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_emergency_contact_plan_idx").on(table.planId),
])

/* ── Simulacros ─────────────────────────────────────────────────────────────
 * Programar y ejecutar un simulacro, con resultado explícito. Un simulacro
 * con resultado "needs_improvement" deriva su hallazgo a CAPA común: el
 * aprendizaje del simulacro no se queda en un campo de texto.
 */
export const preventionEmergencyDrills = pgTable("prevention_emergency_drills", {
  id:                text("id").primaryKey(),
  planId:            text("plan_id").notNull().references(() => preventionEmergencyPlans.id, { onDelete: "restrict" }),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  scenarioType:      text("scenario_type").notNull(),
  scheduledFor:      timestamp("scheduled_for", { withTimezone: true, mode: "string" }).notNull(),
  executedAt:        timestamp("executed_at", { withTimezone: true, mode: "string" }),
  status:            text("status").notNull().default("scheduled"),
  durationMinutes:   integer("duration_minutes"),
  evacuationSeconds: integer("evacuation_seconds"),
  observations:      text("observations"),
  outcome:           text("outcome"),
  capaActionId:      text("capa_action_id").references(() => preventionCapaActions.id, { onDelete: "set null" }),
  createdByUserId:   text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  version:           integer("version").notNull().default(1),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_emergency_drill_plan_idx").on(table.planId, table.scheduledFor),
  check("prevention_emergency_drill_scenario_type_valid", sql`${table.scenarioType} IN ('incendio', 'derrame', 'fuga', 'volcamiento', 'exposicion', 'rescate', 'sismo', 'clima', 'otro')`),
  check("prevention_emergency_drill_status_valid", sql`${table.status} IN ('scheduled', 'completed', 'cancelled')`),
  check("prevention_emergency_drill_outcome_valid", sql`${table.outcome} IS NULL OR ${table.outcome} IN ('satisfactory', 'needs_improvement')`),
  check("prevention_emergency_drill_completed_consistent", sql`${table.status} <> 'completed' OR (${table.executedAt} IS NOT NULL AND ${table.outcome} IS NOT NULL)`),
  check("prevention_emergency_drill_version_positive", sql`${table.version} >= 1`),
])

export const preventionEmergencyDrillParticipants = pgTable("prevention_emergency_drill_participants", {
  id:        text("id").primaryKey(),
  drillId:   text("drill_id").notNull().references(() => preventionEmergencyDrills.id, { onDelete: "cascade" }),
  workerId:  text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  present:   boolean("present").notNull().default(true),
  roleName:  text("role_name"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_emergency_drill_participant_unique").on(table.drillId, table.workerId),
])

/* ── Historial inmutable ──────────────────────────────────────────────────── */
export const preventionEmergencyHistory = pgTable("prevention_emergency_history", {
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
  index("prevention_emergency_history_entity_idx").on(table.entityType, table.entityId, table.createdAt),
])

/* ── Relations ────────────────────────────────────────────────────────────── */
export const preventionEmergencyPlansRelations = relations(preventionEmergencyPlans, ({ one, many }) => ({
  worksite: one(worksites, { fields: [preventionEmergencyPlans.worksiteId], references: [worksites.id] }),
  scenarios: many(preventionEmergencyScenarios),
  roles: many(preventionEmergencyRoles),
  resources: many(preventionEmergencyResources),
  contacts: many(preventionEmergencyContacts),
  drills: many(preventionEmergencyDrills),
}))

export const preventionEmergencyScenariosRelations = relations(preventionEmergencyScenarios, ({ one }) => ({
  plan: one(preventionEmergencyPlans, { fields: [preventionEmergencyScenarios.planId], references: [preventionEmergencyPlans.id] }),
}))

export const preventionEmergencyRolesRelations = relations(preventionEmergencyRoles, ({ one }) => ({
  plan: one(preventionEmergencyPlans, { fields: [preventionEmergencyRoles.planId], references: [preventionEmergencyPlans.id] }),
  assignee: one(workers, { fields: [preventionEmergencyRoles.assigneeWorkerId], references: [workers.id], relationName: "preventionEmergencyRoleAssignee" }),
  backup: one(workers, { fields: [preventionEmergencyRoles.backupWorkerId], references: [workers.id], relationName: "preventionEmergencyRoleBackup" }),
}))

export const preventionEmergencyResourcesRelations = relations(preventionEmergencyResources, ({ one }) => ({
  plan: one(preventionEmergencyPlans, { fields: [preventionEmergencyResources.planId], references: [preventionEmergencyPlans.id] }),
}))

export const preventionEmergencyContactsRelations = relations(preventionEmergencyContacts, ({ one }) => ({
  plan: one(preventionEmergencyPlans, { fields: [preventionEmergencyContacts.planId], references: [preventionEmergencyPlans.id] }),
}))

export const preventionEmergencyDrillsRelations = relations(preventionEmergencyDrills, ({ one, many }) => ({
  plan: one(preventionEmergencyPlans, { fields: [preventionEmergencyDrills.planId], references: [preventionEmergencyPlans.id] }),
  worksite: one(worksites, { fields: [preventionEmergencyDrills.worksiteId], references: [worksites.id] }),
  capaAction: one(preventionCapaActions, { fields: [preventionEmergencyDrills.capaActionId], references: [preventionCapaActions.id] }),
  participants: many(preventionEmergencyDrillParticipants),
}))

export const preventionEmergencyDrillParticipantsRelations = relations(preventionEmergencyDrillParticipants, ({ one }) => ({
  drill: one(preventionEmergencyDrills, { fields: [preventionEmergencyDrillParticipants.drillId], references: [preventionEmergencyDrills.id] }),
  worker: one(workers, { fields: [preventionEmergencyDrillParticipants.workerId], references: [workers.id] }),
}))

export type PreventionEmergencyPlan = typeof preventionEmergencyPlans.$inferSelect
export type PreventionEmergencyScenario = typeof preventionEmergencyScenarios.$inferSelect
export type PreventionEmergencyRole = typeof preventionEmergencyRoles.$inferSelect
export type PreventionEmergencyResource = typeof preventionEmergencyResources.$inferSelect
export type PreventionEmergencyContact = typeof preventionEmergencyContacts.$inferSelect
export type PreventionEmergencyDrill = typeof preventionEmergencyDrills.$inferSelect
export type PreventionEmergencyDrillParticipant = typeof preventionEmergencyDrillParticipants.$inferSelect

import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"
import { preventionCapaActions } from "./capa"

/* ── Gestión del cambio ────────────────────────────────────────────────────
 * DS 44 art. 15: un cambio de proceso, instalación, equipo, sustancia,
 * proveedor, requisito legal, dotación, software o procedimiento debe
 * evaluar su impacto en riesgos, permisos, capacitación, documentos, MIPER y
 * emergencia antes de aprobarse. Aprobar exige que todas las dimensiones
 * requeridas estén evaluadas y que exista una fecha de revisión posterior
 * (assessChangeReadiness) — sin eso el cambio queda sin trazabilidad de qué
 * se evaluó y cuándo se revisa si la evaluación siguió siendo válida.
 */
export const preventionChangeRequests = pgTable("prevention_change_requests", {
  id:                text("id").primaryKey(),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  code:              text("code").notNull().unique(),
  title:             text("title").notNull(),
  changeType:        text("change_type").notNull(),
  description:       text("description").notNull(),
  reason:            text("reason").notNull(),
  riskLevel:         text("risk_level").notNull().default("medium"),
  status:            text("status").notNull().default("draft"),
  plannedReviewDate: text("planned_review_date"),
  requestedByUserId: text("requested_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  approvedByUserId:  text("approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  approvedAt:        timestamp("approved_at", { withTimezone: true, mode: "string" }),
  rejectedReason:    text("rejected_reason"),
  implementedAt:     timestamp("implemented_at", { withTimezone: true, mode: "string" }),
  closedAt:          timestamp("closed_at", { withTimezone: true, mode: "string" }),
  version:           integer("version").notNull().default(1),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("prevention_change_type_valid", sql`${table.changeType} IN ('proceso', 'instalacion', 'equipo', 'sustancia', 'proveedor', 'requisito_legal', 'dotacion', 'software', 'procedimiento', 'mandante')`),
  check("prevention_change_risk_level_valid", sql`${table.riskLevel} IN ('low', 'medium', 'high', 'critical')`),
  check("prevention_change_status_valid", sql`${table.status} IN ('draft', 'under_evaluation', 'approved', 'rejected', 'implemented', 'closed')`),
  check("prevention_change_approved_consistent", sql`(${table.status} <> 'approved') OR (${table.approvedByUserId} IS NOT NULL AND ${table.approvedAt} IS NOT NULL AND ${table.plannedReviewDate} IS NOT NULL)`),
  check("prevention_change_rejected_consistent", sql`(${table.status} <> 'rejected') OR (${table.rejectedReason} IS NOT NULL AND length(${table.rejectedReason}) >= 5)`),
  check("prevention_change_version_positive", sql`${table.version} >= 1`),
])

/* ── Evaluación por dimensión ─────────────────────────────────────────────
 * Una fila por dimensión de impacto. `impacted` y `actionRequired` se
 * declaran por separado: un cambio puede impactar una dimensión (por
 * ejemplo, riesgo) sin que se requiera una acción nueva si el control ya
 * existente la cubre.
 */
export const preventionChangeAssessments = pgTable("prevention_change_assessments", {
  id:               text("id").primaryKey(),
  changeRequestId:  text("change_request_id").notNull().references(() => preventionChangeRequests.id, { onDelete: "cascade" }),
  dimension:        text("dimension").notNull(),
  evaluated:        boolean("evaluated").notNull().default(false),
  impacted:         boolean("impacted").notNull().default(false),
  notes:            text("notes"),
  actionRequired:   boolean("action_required").notNull().default(false),
  capaActionId:     text("capa_action_id").references(() => preventionCapaActions.id, { onDelete: "set null" }),
  evaluatedByUserId: text("evaluated_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  evaluatedAt:      timestamp("evaluated_at", { withTimezone: true, mode: "string" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_change_assessment_unique").on(table.changeRequestId, table.dimension),
  index("prevention_change_assessment_request_idx").on(table.changeRequestId),
  check("prevention_change_assessment_dimension_valid", sql`${table.dimension} IN ('risk', 'permit', 'training', 'document', 'miper', 'emergency')`),
  check("prevention_change_assessment_evaluated_consistent", sql`${table.evaluated} = false OR (${table.evaluatedByUserId} IS NOT NULL AND ${table.evaluatedAt} IS NOT NULL)`),
  check("prevention_change_assessment_impact_consistent", sql`${table.impacted} = true OR ${table.actionRequired} = false`),
  check("prevention_change_assessment_action_consistent", sql`${table.actionRequired} = false OR ${table.capaActionId} IS NOT NULL`),
])

/* ── Historial inmutable ──────────────────────────────────────────────────── */
export const preventionChangeHistory = pgTable("prevention_change_history", {
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
  index("prevention_change_history_entity_idx").on(table.entityType, table.entityId, table.createdAt),
])

/* ── Relations ────────────────────────────────────────────────────────────── */
export const preventionChangeRequestsRelations = relations(preventionChangeRequests, ({ one, many }) => ({
  worksite: one(worksites, { fields: [preventionChangeRequests.worksiteId], references: [worksites.id] }),
  requestedBy: one(users, { fields: [preventionChangeRequests.requestedByUserId], references: [users.id], relationName: "preventionChangeRequestedBy" }),
  approvedBy: one(users, { fields: [preventionChangeRequests.approvedByUserId], references: [users.id], relationName: "preventionChangeApprovedBy" }),
  assessments: many(preventionChangeAssessments),
}))

export const preventionChangeAssessmentsRelations = relations(preventionChangeAssessments, ({ one }) => ({
  changeRequest: one(preventionChangeRequests, { fields: [preventionChangeAssessments.changeRequestId], references: [preventionChangeRequests.id] }),
  evaluatedBy: one(users, { fields: [preventionChangeAssessments.evaluatedByUserId], references: [users.id] }),
  capaAction: one(preventionCapaActions, { fields: [preventionChangeAssessments.capaActionId], references: [preventionCapaActions.id] }),
}))

export type PreventionChangeRequest = typeof preventionChangeRequests.$inferSelect
export type PreventionChangeAssessment = typeof preventionChangeAssessments.$inferSelect

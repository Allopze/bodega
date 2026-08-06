import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"
import { preventionCapaActions } from "./capa"
import { preventionRiskEntries } from "./risk-legal"

/* ── Plantillas versionadas ───────────────────────────────────────────────
 * El contenido reutiliza `ChecklistDefinition` de `lib/sst/types`, que ya
 * modela secciones, ítems y `danoPotencial`. La plantilla guarda un snapshot
 * inmutable al aprobarse: una edición posterior del catálogo en código no debe
 * cambiar la evidencia de una inspección ya ejecutada.
 */
export const preventionInspectionTemplates = pgTable("prevention_inspection_templates", {
  id:                text("id").primaryKey(),
  code:              text("code").notNull(),
  versionLabel:      text("version_label").notNull(),
  name:              text("name").notNull(),
  kind:              text("kind").notNull(),
  sourceDefinitionCode: text("source_definition_code"),
  definitionSnapshot: jsonb("definition_snapshot").notNull(),
  contentHash:       text("content_hash").notNull(),
  status:            text("status").notNull().default("draft"),
  legalFramework:    text("legal_framework"),
  authorUserId:      text("author_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  approvedByUserId:  text("approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  approvedAt:        timestamp("approved_at", { withTimezone: true, mode: "string" }),
  supersededAt:      timestamp("superseded_at", { withTimezone: true, mode: "string" }),
  supersededByTemplateId: text("superseded_by_template_id"),
  /** Números de actividad PDTP (campo `n`) que esta plantilla acredita al
   * completar un run. Null = no vinculado al PDTP (comportamiento previo). */
  pdtpActivityNumbers: jsonb("pdtp_activity_numbers").$type<number[]>(),
  version:           integer("version").notNull().default(1),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_inspection_template_version_unique").on(table.code, table.versionLabel),
  index("prevention_inspection_template_status_idx").on(table.code, table.status),
  check("prevention_inspection_template_kind_valid", sql`${table.kind} IN ('inspection', 'observation', 'audit')`),
  check("prevention_inspection_template_status_valid", sql`${table.status} IN ('draft', 'approved', 'superseded')`),
  check("prevention_inspection_template_hash_valid", sql`length(${table.contentHash}) = 64`),
  check("prevention_inspection_template_approved_consistent", sql`${table.status} <> 'approved' OR (${table.approvedByUserId} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)`),
  check("prevention_inspection_template_version_positive", sql`${table.version} >= 1`),
])

/* ── Programación por faena y frecuencia ──────────────────────────────────── */
export const preventionInspectionPrograms = pgTable("prevention_inspection_programs", {
  id:                text("id").primaryKey(),
  templateId:        text("template_id").notNull().references(() => preventionInspectionTemplates.id, { onDelete: "restrict" }),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  frequency:         text("frequency").notNull(),
  intervalDays:      integer("interval_days").notNull(),
  nextDueOn:         text("next_due_on").notNull(),
  assignedToUserId:  text("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  riskEntryId:       text("risk_entry_id").references(() => preventionRiskEntries.id, { onDelete: "set null" }),
  subjectType:       text("subject_type"),
  isActive:          boolean("is_active").notNull().default(true),
  createdByUserId:   text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_inspection_program_due_idx").on(table.nextDueOn, table.isActive),
  index("prevention_inspection_program_worksite_idx").on(table.worksiteId, table.isActive),
  check("prevention_inspection_program_frequency_valid", sql`${table.frequency} IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'biannual', 'annual', 'on_demand')`),
  check("prevention_inspection_program_interval_positive", sql`${table.intervalDays} > 0`),
])

/* ── Ejecución ────────────────────────────────────────────────────────────
 * `reviewed` es un estado distinto de `completed` a propósito: la auditoría
 * §7.8 exige revisión y cierre independientes de quien ejecutó.
 */
export const preventionInspectionRuns = pgTable("prevention_inspection_runs", {
  id:                text("id").primaryKey(),
  code:              text("code").notNull().unique(),
  templateId:        text("template_id").notNull().references(() => preventionInspectionTemplates.id, { onDelete: "restrict" }),
  programId:         text("program_id").references(() => preventionInspectionPrograms.id, { onDelete: "set null" }),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  subjectType:       text("subject_type"),
  subjectLabel:      text("subject_label"),
  scheduledFor:      text("scheduled_for"),
  status:            text("status").notNull().default("planned"),
  assignedToUserId:  text("assigned_to_user_id").references(() => users.id, { onDelete: "restrict" }),
  executedByUserId:  text("executed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  executedAt:        timestamp("executed_at", { withTimezone: true, mode: "string" }),
  reviewedByUserId:  text("reviewed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  reviewedAt:        timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  reviewComment:     text("review_comment"),
  cancelledByUserId: text("cancelled_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  cancelledAt:       timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  cancellationReason: text("cancellation_reason"),
  conformingCount:   integer("conforming_count").notNull().default(0),
  /** Respuestas 'partial' (escala B/R/M "Regular"). Puntúan 0,5 en `compliancePercent` — ver PARTIAL_STATUS_WEIGHT en lib/sst/compliance.ts. */
  partialCount:      integer("partial_count").notNull().default(0),
  nonConformingCount: integer("non_conforming_count").notNull().default(0),
  notApplicableCount: integer("not_applicable_count").notNull().default(0),
  compliancePercent: integer("compliance_percent"),
  locationLatitude:  text("location_latitude"),
  locationLongitude: text("location_longitude"),
  clientSubmissionId: text("client_submission_id"),
  version:           integer("version").notNull().default(1),
  createdByUserId:   text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_inspection_run_submission_unique").on(table.clientSubmissionId)
    .where(sql`${table.clientSubmissionId} IS NOT NULL`),
  index("prevention_inspection_run_worksite_idx").on(table.worksiteId, table.status),
  index("prevention_inspection_run_template_idx").on(table.templateId, table.executedAt),
  check("prevention_inspection_run_status_valid", sql`${table.status} IN ('planned', 'in_progress', 'completed', 'reviewed', 'cancelled')`),
  check("prevention_inspection_run_compliance_valid", sql`${table.compliancePercent} IS NULL OR ${table.compliancePercent} BETWEEN 0 AND 100`),
  check("prevention_inspection_run_counts_nonnegative", sql`${table.conformingCount} >= 0 AND ${table.partialCount} >= 0 AND ${table.nonConformingCount} >= 0 AND ${table.notApplicableCount} >= 0`),
  check("prevention_inspection_run_cancel_consistent", sql`(${table.cancelledAt} IS NULL AND ${table.cancelledByUserId} IS NULL) OR (${table.cancelledAt} IS NOT NULL AND ${table.cancelledByUserId} IS NOT NULL AND length(${table.cancellationReason}) >= 5)`),
  check("prevention_inspection_run_review_consistent", sql`(${table.reviewedAt} IS NULL AND ${table.reviewedByUserId} IS NULL) OR (${table.reviewedAt} IS NOT NULL AND ${table.reviewedByUserId} IS NOT NULL)`),
  check("prevention_inspection_run_version_positive", sql`${table.version} >= 1`),
])

/* ── Respuestas ───────────────────────────────────────────────────────────── */
export const preventionInspectionAnswers = pgTable("prevention_inspection_answers", {
  id:               text("id").primaryKey(),
  runId:            text("run_id").notNull().references(() => preventionInspectionRuns.id, { onDelete: "cascade" }),
  sectionId:        text("section_id").notNull(),
  itemId:           text("item_id").notNull(),
  itemLabel:        text("item_label").notNull(),
  result:           text("result").notNull(),
  value:            text("value"),
  comment:          text("comment"),
  evidenceReference: text("evidence_reference"),
  danoPotencial:    text("dano_potencial"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_inspection_answer_unique").on(table.runId, table.sectionId, table.itemId),
  // 'partial' = escala B/R/M "Regular" (H-04, AUDITORIA_BUGS_2026-08-05.md):
  // el motor transversal solo tenía cumple/no cumple/no aplica, perdiendo el
  // estado intermedio que el catálogo de ítems B/R/M (lib/sst/definitions)
  // declara y que el motor SST (lib/sst/compliance.ts) ya puntúa en 0,5.
  check("prevention_inspection_answer_result_valid", sql`${table.result} IN ('conforming', 'partial', 'non_conforming', 'not_applicable')`),
  // 'partial' exige observación igual que 'not_applicable': es la misma regla
  // que ya rige la escala B/R/M en el motor SST (requiresObservation en
  // lib/sst/compliance.ts — 'regular' siempre justifica por escrito, ahí
  // sin distinguir por ítem). 'non_conforming' queda fuera a propósito: ya
  // se permite sin comentario en este motor y cambiar eso es un ajuste
  // aparte, no parte de H-04.
  check("prevention_inspection_answer_requires_comment", sql`${table.result} NOT IN ('not_applicable', 'partial') OR length(${table.comment}) >= 3`),
  check("prevention_inspection_answer_dano_valid", sql`${table.danoPotencial} IS NULL OR ${table.danoPotencial} IN ('leve', 'moderado', 'grave', 'fatal')`),
])

/* ── Hallazgos ────────────────────────────────────────────────────────────
 * Un hallazgo nace de una respuesta no conforme. Su criticidad deriva del
 * `danoPotencial` declarado en la plantilla, no del criterio del ejecutante.
 */
export const preventionInspectionFindings = pgTable("prevention_inspection_findings", {
  id:                text("id").primaryKey(),
  runId:             text("run_id").notNull().references(() => preventionInspectionRuns.id, { onDelete: "cascade" }),
  answerId:          text("answer_id").references(() => preventionInspectionAnswers.id, { onDelete: "set null" }),
  description:       text("description").notNull(),
  criticality:       text("criticality").notNull(),
  immediateMeasure:  text("immediate_measure"),
  capaActionId:      text("capa_action_id").references(() => preventionCapaActions.id, { onDelete: "set null" }),
  status:            text("status").notNull().default("open"),
  closedByUserId:    text("closed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  closedAt:          timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_inspection_finding_run_idx").on(table.runId, table.status),
  check("prevention_inspection_finding_criticality_valid", sql`${table.criticality} IN ('low', 'medium', 'high', 'critical')`),
  check("prevention_inspection_finding_status_valid", sql`${table.status} IN ('open', 'capa_linked', 'closed')`),
  check("prevention_inspection_finding_closed_consistent", sql`(${table.closedAt} IS NULL AND ${table.closedByUserId} IS NULL) OR (${table.closedAt} IS NOT NULL AND ${table.closedByUserId} IS NOT NULL)`),
])

/* ── Historial inmutable ──────────────────────────────────────────────────── */
export const preventionInspectionHistory = pgTable("prevention_inspection_history", {
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
  index("prevention_inspection_history_entity_idx").on(table.entityType, table.entityId, table.createdAt),
])

/* ── Relations ────────────────────────────────────────────────────────────── */
export const preventionInspectionTemplatesRelations = relations(preventionInspectionTemplates, ({ many }) => ({
  programs: many(preventionInspectionPrograms),
  runs: many(preventionInspectionRuns),
}))

export const preventionInspectionProgramsRelations = relations(preventionInspectionPrograms, ({ one, many }) => ({
  template: one(preventionInspectionTemplates, { fields: [preventionInspectionPrograms.templateId], references: [preventionInspectionTemplates.id] }),
  worksite: one(worksites, { fields: [preventionInspectionPrograms.worksiteId], references: [worksites.id] }),
  runs: many(preventionInspectionRuns),
}))

export const preventionInspectionRunsRelations = relations(preventionInspectionRuns, ({ one, many }) => ({
  template: one(preventionInspectionTemplates, { fields: [preventionInspectionRuns.templateId], references: [preventionInspectionTemplates.id] }),
  program: one(preventionInspectionPrograms, { fields: [preventionInspectionRuns.programId], references: [preventionInspectionPrograms.id] }),
  worksite: one(worksites, { fields: [preventionInspectionRuns.worksiteId], references: [worksites.id] }),
  answers: many(preventionInspectionAnswers),
  findings: many(preventionInspectionFindings),
}))

export const preventionInspectionAnswersRelations = relations(preventionInspectionAnswers, ({ one }) => ({
  run: one(preventionInspectionRuns, { fields: [preventionInspectionAnswers.runId], references: [preventionInspectionRuns.id] }),
}))

export const preventionInspectionFindingsRelations = relations(preventionInspectionFindings, ({ one }) => ({
  run: one(preventionInspectionRuns, { fields: [preventionInspectionFindings.runId], references: [preventionInspectionRuns.id] }),
  capaAction: one(preventionCapaActions, { fields: [preventionInspectionFindings.capaActionId], references: [preventionCapaActions.id] }),
}))

export type PreventionInspectionTemplate = typeof preventionInspectionTemplates.$inferSelect
export type PreventionInspectionProgram = typeof preventionInspectionPrograms.$inferSelect
export type PreventionInspectionRun = typeof preventionInspectionRuns.$inferSelect
export type PreventionInspectionAnswer = typeof preventionInspectionAnswers.$inferSelect
export type PreventionInspectionFinding = typeof preventionInspectionFindings.$inferSelect

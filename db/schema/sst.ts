import { relations, sql } from "drizzle-orm"
import { pgTable, text, timestamp, real, boolean, integer, jsonb, uniqueIndex, index, check } from "drizzle-orm/pg-core"
import { worksites, workers } from "./worksites"
import { users } from "./users"
import { preventionCapaActions } from "./prevention/capa"

/* ── SST Evaluation Visits ───────────────────────────────────────────────── */
// A visit is the durable parent for the three possible evaluator-role
// participations. Legacy evaluations may not yet have a visitId.
export const sstEvaluationVisits = pgTable("sst_evaluation_visits", {
  id:               text("id").primaryKey(),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id),
  workerId:         text("worker_id").notNull().references(() => workers.id),
  fechaVisita:      text("fecha_visita").notNull(),
  estado:           text("estado").notNull().default("borrador"),
  closedByUserId:   text("closed_by_user_id").references(() => users.id),
  closedAt:         timestamp("closed_at", { withTimezone: true, mode: "string" }),
  reopenedByUserId: text("reopened_by_user_id").references(() => users.id),
  reopenedAt:       timestamp("reopened_at", { withTimezone: true, mode: "string" }),
  reopeningReason:  text("reopening_reason"),
  createdBy:        text("created_by").notNull().references(() => users.id),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("idx_sst_visit_worker_date").on(table.workerId, table.fechaVisita, table.createdAt),
  index("idx_sst_visit_worksite_date").on(table.worksiteId, table.fechaVisita),
  check("sst_evaluation_visits_estado_check", sql`${table.estado} IN ('borrador', 'en_revision', 'cerrada')`),
  check("sst_evaluation_visits_reopen_check", sql`(${table.reopenedAt} IS NULL AND ${table.reopenedByUserId} IS NULL AND ${table.reopeningReason} IS NULL) OR (${table.reopenedAt} IS NOT NULL AND ${table.reopenedByUserId} IS NOT NULL AND length(${table.reopeningReason}) >= 3)`),
])

/* ── SST Evaluations ─────────────────────────────────────────────────────── */
// Main evaluation record — one participation per evaluator role in a visit.
// tipo: 'nuevo' | 'seguimiento'
// estado: 'borrador' | 'cerrado'
// evaluatorRole: EvaluatorRole ('prevencionista_faena' | 'admin_contrato' | 'conductor_lider' | null for legacy)
// resultadoFinal: ResultadoFinal
// resultadoEficacia: ResultadoEficacia
export const sstEvaluations = pgTable("sst_evaluations", {
  id:                     text("id").primaryKey(),
  visitId:                text("visit_id").references(() => sstEvaluationVisits.id, { onDelete: "restrict" }),
  worksiteId:             text("worksite_id").notNull().references(() => worksites.id),
  workerId:               text("worker_id").notNull().references(() => workers.id),
  createdBy:              text("created_by").notNull().references(() => users.id),
  definicionCode:         text("definicion_code").notNull(),         // 'trabajador_nuevo' | 'trabajador_antiguo'
  definicionVersion:      text("definicion_version").notNull(),      // '01'
  tipo:                   text("tipo").notNull(),                    // TipoEvaluacion: 'nuevo' | 'seguimiento'
  evaluatorRole:          text("evaluator_role"),                    // EvaluatorRole: 'prevencionista_faena' | 'admin_contrato' | 'conductor_lider' | null (legacy)
  motivo:                 text("motivo"),                            // MotivoSeguimiento
  motivoOtro:             text("motivo_otro"),
  descripcionEvento:      text("descripcion_evento"),
  equipoPatente:          text("equipo_patente"),
  fechaEvaluacion:        text("fecha_evaluacion").notNull(),        // ISO date string 'YYYY-MM-DD'
  estado:                 text("estado").notNull().default("borrador"), // EstadoEvaluacion
  cargosJson:             jsonb("cargos_json"),                       // string[] of CargoKey
  resultadoFinal:         text("resultado_final"),                   // ResultadoFinal
  porcentajeCumplimiento: real("porcentaje_cumplimiento"),
  resultadoEficacia:      text("resultado_eficacia"),                // ResultadoEficacia
  restricciones:          text("restricciones"),
  observacionesGenerales: text("observaciones_generales"),
  schemaJson:             text("schema_json"),                       // snapshot of ChecklistDefinition at close time
  createdAt:              timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:              timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("idx_sst_worksite_estado").on(table.worksiteId, table.estado, table.createdAt),
  index("idx_sst_worker").on(table.workerId, table.createdAt),
  index("idx_sst_visit").on(table.visitId),
])

/* ── SST Responses ───────────────────────────────────────────────────────── */
// One row per checklist item per evaluation (upsert on evaluationId + seccionId + itemId).
// estado: StatusValue ('cumple' | 'no_cumple' | 'no_aplica')
export const sstResponses = pgTable("sst_responses", {
  id:               text("id").primaryKey(),
  evaluationId:     text("evaluation_id").notNull().references(() => sstEvaluations.id, { onDelete: "cascade" }),
  seccionId:        text("seccion_id").notNull(),
  itemId:           text("item_id").notNull(),
  estado:           text("estado"),   // StatusValue
  observacion:      text("observacion"),
  accionCorrectiva: text("accion_correctiva"),
}, (table) => [
  uniqueIndex("sst_responses_evaluation_section_item_unique").on(table.evaluationId, table.seccionId, table.itemId),
])

/* ── SST Scheduled Followups ─────────────────────────────────────────────── */
// 4 hitos created when tipo === 'seguimiento': dia_0 / dia_7 / dia_15 / dia_30
export const sstScheduledFollowups = pgTable("sst_scheduled_followups", {
  id:              text("id").primaryKey(),
  evaluationId:    text("evaluation_id").notNull().references(() => sstEvaluations.id, { onDelete: "cascade" }),
  instancia:       text("instancia").notNull(),    // 'dia_0' | 'dia_7' | 'dia_15' | 'dia_30'
  fechaProgramada: text("fecha_programada").notNull(),
  cumple:          boolean("cumple"),
  observaciones:   text("observaciones"),
  realizado:       boolean("realizado").notNull().default(false),
}, (table) => [
  index("idx_sst_followup_eval").on(table.evaluationId),
])

/* ── SST Action Plan ─────────────────────────────────────────────────────── */
// Corrective action items per evaluation.
export const sstActionPlan = pgTable("sst_action_plan", {
  id:           text("id").primaryKey(),
  evaluationId: text("evaluation_id").notNull().references(() => sstEvaluations.id, { onDelete: "cascade" }),
  capaActionId: text("capa_action_id").references(() => preventionCapaActions.id, { onDelete: "restrict" }),
  n:            integer("n").notNull(),
  hallazgo:     text("hallazgo").notNull(),
  accion:       text("accion").notNull(),
  responsable:  text("responsable").notNull(),
  plazo:        text("plazo").notNull(),
  estado:       text("estado").notNull(),
}, (table) => [
  uniqueIndex("sst_action_plan_evaluation_n_unique").on(table.evaluationId, table.n),
  uniqueIndex("sst_action_plan_capa_unique").on(table.capaActionId),
])

/* ── SST Weekly Evaluations ──────────────────────────────────────────────── */
// 4 hitos semanales creados cuando conductor_lider inicia evaluación de trabajador_nuevo.
// Cada semana tiene sus propias respuestas en sstResponses con seccionId = 'acompanamiento_terreno_sN'.
// estado: 'pendiente' | 'completada'
export const sstWeeklyEvaluations = pgTable("sst_weekly_evaluations", {
  id:               text("id").primaryKey(),
  evaluationId:     text("evaluation_id").notNull().references(() => sstEvaluations.id, { onDelete: "cascade" }),
  semana:           integer("semana").notNull(),           // 1, 2, 3, 4
  fechaDesbloqueo:  text("fecha_desbloqueo").notNull(),    // ISO date: cuándo se desbloquea para editar
  estado:           text("estado").notNull().default("pendiente"), // 'pendiente' | 'completada'
  fechaCompletada:  text("fecha_completada"),              // ISO date: cuándo se marcó completada
  alertSentAt:      timestamp("alert_sent_at", { withTimezone: true, mode: "string" }), // cuándo se envió la alerta de mora
})

/* ── Relations ───────────────────────────────────────────────────────────── */
export const sstEvaluationsRelations = relations(sstEvaluations, ({ one, many }) => ({
  visit:           one(sstEvaluationVisits, { fields: [sstEvaluations.visitId], references: [sstEvaluationVisits.id] }),
  worksite:        one(worksites,  { fields: [sstEvaluations.worksiteId], references: [worksites.id] }),
  worker:          one(workers,    { fields: [sstEvaluations.workerId],   references: [workers.id] }),
  createdByUser:   one(users,      { fields: [sstEvaluations.createdBy],  references: [users.id] }),
  responses:       many(sstResponses),
  followups:       many(sstScheduledFollowups),
  actionPlan:      many(sstActionPlan),
  weeklyEvals:     many(sstWeeklyEvaluations),
}))

export const sstEvaluationVisitsRelations = relations(sstEvaluationVisits, ({ one, many }) => ({
  worksite:        one(worksites, { fields: [sstEvaluationVisits.worksiteId], references: [worksites.id] }),
  worker:          one(workers, { fields: [sstEvaluationVisits.workerId], references: [workers.id] }),
  createdByUser:   one(users, { fields: [sstEvaluationVisits.createdBy], references: [users.id] }),
  evaluations:     many(sstEvaluations),
}))

export const sstResponsesRelations = relations(sstResponses, ({ one }) => ({
  evaluation: one(sstEvaluations, { fields: [sstResponses.evaluationId], references: [sstEvaluations.id] }),
}))

export const sstScheduledFollowupsRelations = relations(sstScheduledFollowups, ({ one }) => ({
  evaluation: one(sstEvaluations, { fields: [sstScheduledFollowups.evaluationId], references: [sstEvaluations.id] }),
}))

export const sstActionPlanRelations = relations(sstActionPlan, ({ one }) => ({
  evaluation: one(sstEvaluations, { fields: [sstActionPlan.evaluationId], references: [sstEvaluations.id] }),
}))

export const sstWeeklyEvaluationsRelations = relations(sstWeeklyEvaluations, ({ one }) => ({
  evaluation: one(sstEvaluations, { fields: [sstWeeklyEvaluations.evaluationId], references: [sstEvaluations.id] }),
}))

/* ── Inferred Types ──────────────────────────────────────────────────────── */
export type SstEvaluation           = typeof sstEvaluations.$inferSelect
export type NewSstEvaluation        = typeof sstEvaluations.$inferInsert
export type SstEvaluationVisit      = typeof sstEvaluationVisits.$inferSelect
export type NewSstEvaluationVisit   = typeof sstEvaluationVisits.$inferInsert
export type SstResponse             = typeof sstResponses.$inferSelect
export type NewSstResponse          = typeof sstResponses.$inferInsert
export type SstScheduledFollowup    = typeof sstScheduledFollowups.$inferSelect
export type NewSstScheduledFollowup = typeof sstScheduledFollowups.$inferInsert
export type SstActionPlan           = typeof sstActionPlan.$inferSelect
export type NewSstActionPlan        = typeof sstActionPlan.$inferInsert
export type SstWeeklyEvaluation     = typeof sstWeeklyEvaluations.$inferSelect
export type NewSstWeeklyEvaluation  = typeof sstWeeklyEvaluations.$inferInsert

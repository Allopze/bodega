import { relations } from "drizzle-orm"
import { pgTable, text, timestamp, real, boolean, integer, jsonb } from "drizzle-orm/pg-core"
import { worksites, workers } from "./worksites"
import { users } from "./users"

/* ── SST Evaluations ─────────────────────────────────────────────────────── */
// Main evaluation record — one per worker per checklist visit, per evaluator role.
// tipo: 'nuevo' | 'seguimiento'
// estado: 'borrador' | 'cerrado'
// evaluatorRole: EvaluatorRole ('prevencionista_faena' | 'admin_contrato' | 'conductor_lider' | null for legacy)
// resultadoFinal: ResultadoFinal
// resultadoEficacia: ResultadoEficacia
export const sstEvaluations = pgTable("sst_evaluations", {
  id:                     text("id").primaryKey(),
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
})

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
})

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
})

/* ── SST Action Plan ─────────────────────────────────────────────────────── */
// Corrective action items per evaluation.
export const sstActionPlan = pgTable("sst_action_plan", {
  id:           text("id").primaryKey(),
  evaluationId: text("evaluation_id").notNull().references(() => sstEvaluations.id, { onDelete: "cascade" }),
  n:            integer("n").notNull(),
  hallazgo:     text("hallazgo").notNull(),
  accion:       text("accion").notNull(),
  responsable:  text("responsable").notNull(),
  plazo:        text("plazo").notNull(),
  estado:       text("estado").notNull(),
})

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
  worksite:        one(worksites,  { fields: [sstEvaluations.worksiteId], references: [worksites.id] }),
  worker:          one(workers,    { fields: [sstEvaluations.workerId],   references: [workers.id] }),
  createdByUser:   one(users,      { fields: [sstEvaluations.createdBy],  references: [users.id] }),
  responses:       many(sstResponses),
  followups:       many(sstScheduledFollowups),
  actionPlan:      many(sstActionPlan),
  weeklyEvals:     many(sstWeeklyEvaluations),
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
export type SstResponse             = typeof sstResponses.$inferSelect
export type NewSstResponse          = typeof sstResponses.$inferInsert
export type SstScheduledFollowup    = typeof sstScheduledFollowups.$inferSelect
export type NewSstScheduledFollowup = typeof sstScheduledFollowups.$inferInsert
export type SstActionPlan           = typeof sstActionPlan.$inferSelect
export type NewSstActionPlan        = typeof sstActionPlan.$inferInsert
export type SstWeeklyEvaluation     = typeof sstWeeklyEvaluations.$inferSelect
export type NewSstWeeklyEvaluation  = typeof sstWeeklyEvaluations.$inferInsert

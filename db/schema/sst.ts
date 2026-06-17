import { relations } from "drizzle-orm"
import { pgTable, text, timestamp, real, boolean, integer, jsonb } from "drizzle-orm/pg-core"
import { worksites, workers } from "./worksites"
import { users } from "./users"

/* ── SST Evaluations ─────────────────────────────────────────────────────── */
// Main evaluation record — one per worker per checklist visit.
// tipo: 'nuevo' | 'seguimiento'
// estado: 'borrador' | 'cerrado'
// resultadoFinal: ResultadoFinal
// resultadoEficacia: ResultadoEficacia
export const sstEvaluations = pgTable("sst_evaluations", {
  id:                     text("id").primaryKey(),
  worksiteId:             text("worksite_id").notNull().references(() => worksites.id),
  workerId:               text("worker_id").notNull().references(() => workers.id),
  createdBy:              text("created_by").notNull().references(() => users.id),
  definicionCode:         text("definicion_code").notNull(),         // 'LC-SST-001' | 'LC-SST-002'
  definicionVersion:      text("definicion_version").notNull(),      // '01'
  tipo:                   text("tipo").notNull(),                    // TipoEvaluacion: 'nuevo' | 'seguimiento'
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

/* ── Relations ───────────────────────────────────────────────────────────── */
export const sstEvaluationsRelations = relations(sstEvaluations, ({ one, many }) => ({
  worksite:    one(worksites,  { fields: [sstEvaluations.worksiteId], references: [worksites.id] }),
  worker:      one(workers,    { fields: [sstEvaluations.workerId],   references: [workers.id] }),
  createdByUser: one(users,   { fields: [sstEvaluations.createdBy],  references: [users.id] }),
  responses:   many(sstResponses),
  followups:   many(sstScheduledFollowups),
  actionPlan:  many(sstActionPlan),
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

/* ── Inferred Types ──────────────────────────────────────────────────────── */
export type SstEvaluation        = typeof sstEvaluations.$inferSelect
export type NewSstEvaluation     = typeof sstEvaluations.$inferInsert
export type SstResponse          = typeof sstResponses.$inferSelect
export type NewSstResponse       = typeof sstResponses.$inferInsert
export type SstScheduledFollowup = typeof sstScheduledFollowups.$inferSelect
export type NewSstScheduledFollowup = typeof sstScheduledFollowups.$inferInsert
export type SstActionPlan        = typeof sstActionPlan.$inferSelect
export type NewSstActionPlan     = typeof sstActionPlan.$inferInsert

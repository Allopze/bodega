import { relations } from "drizzle-orm"
import { pgTable, text, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core"
import { worksites, workers } from "./worksites"
import { users } from "./users"

/* ── PPA Digital (Para, Piensa y Actúa) ──────────────────────────────────────
 * Una fila por envío del formulario preventivo realizado por un trabajador
 * (sin login) antes de iniciar una tarea. La intervención del responsable de
 * revisión se guarda en la misma fila (un PPA = una revisión en el MVP).
 *
 * estado: EstadoPpa  ('aprobado_auto' | 'detenido' | 'en_correccion' |
 *                     'autorizado' | 'rechazado' | 'cerrado')
 * resultado: 'autorizado_auto' | 'detenido'  (resultado automático del envío)
 */
export const ppaSubmissions = pgTable("ppa_submissions", {
  id:                 text("id").primaryKey(),
  worksiteId:         text("worksite_id").notNull().references(() => worksites.id),

  // Identificación del trabajador (sin cuenta de usuario).
  workerId:           text("worker_id").references(() => workers.id), // null si es identificación manual
  workerName:         text("worker_name").notNull(),                  // denormalizado para trazabilidad
  workerRut:          text("worker_rut"),
  workerCompany:      text("worker_company"),
  manualIdentificacion: boolean("manual_identificacion").notNull().default(false),

  // Tarea declarada (CargoKey reutilizado de lib/sst/cargos.ts).
  tipoTrabajo:        text("tipo_trabajo").notNull(),
  esCritica:          boolean("es_critica").notNull().default(false),

  // Respuestas completas del formulario (estructura PpaAnswers).
  answersJson:        jsonb("answers_json").notNull(),

  // Evaluación automática.
  resultado:          text("resultado").notNull(),                    // 'autorizado_auto' | 'detenido'
  triggeredReasons:   jsonb("triggered_reasons").notNull(),           // string[] (PpaStopReason)
  estado:             text("estado").notNull(),                       // EstadoPpa

  // Token público para que el trabajador consulte el resultado de su envío.
  publicToken:        text("public_token").notNull().unique(),
  publicTokenRevokedAt: timestamp("public_token_revoked_at", { withTimezone: true, mode: "string" }),

  // Intervención del responsable de revisión.
  reviewedBy:         text("reviewed_by").references(() => users.id),
  fuiAlLugar:         boolean("fui_al_lugar"),
  accionCorrectiva:   text("accion_correctiva"),
  decision:           text("decision"),                               // 'autorizado' | 'rechazado' | 'correccion'
  reviewNota:         text("review_nota"),
  reviewedAt:         timestamp("reviewed_at", { withTimezone: true, mode: "string" }),

  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("idx_ppa_worksite_estado").on(table.worksiteId, table.estado),
  index("idx_ppa_created").on(table.createdAt),
  index("idx_ppa_worker").on(table.workerId, table.worksiteId),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const ppaSubmissionsRelations = relations(ppaSubmissions, ({ one }) => ({
  worksite:      one(worksites, { fields: [ppaSubmissions.worksiteId], references: [worksites.id] }),
  worker:        one(workers,   { fields: [ppaSubmissions.workerId],   references: [workers.id] }),
  reviewedByUser: one(users,    { fields: [ppaSubmissions.reviewedBy], references: [users.id] }),
}))

/* ── Inferred Types ──────────────────────────────────────────────────────── */
export type PpaSubmission    = typeof ppaSubmissions.$inferSelect
export type NewPpaSubmission = typeof ppaSubmissions.$inferInsert

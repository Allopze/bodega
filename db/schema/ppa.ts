import { relations, sql } from "drizzle-orm"
import { pgTable, text, timestamp, boolean, integer, jsonb, index, check } from "drizzle-orm/pg-core"
import { worksites, workers } from "./worksites"
import { users } from "./users"
import { preventionCapaActions } from "./prevention/capa"

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

  // Clave de idempotencia del envío (misma pauta que incidentes, TAE e
  // inspecciones). La cola offline reenvía cuando la sincronización se
  // interrumpe entre el commit y la confirmación al cliente: el UNIQUE hace
  // que ese reenvío recupere la fila original en vez de duplicar el PPA.
  // Nullable porque las filas anteriores a la migración no la tienen; en
  // Postgres los NULL no colisionan entre sí, así que el UNIQUE convive con
  // ellas sin backfill.
  clientSubmissionId: text("client_submission_id").unique(),

  // Intervención del responsable de revisión.
  reviewedBy:         text("reviewed_by").references(() => users.id),
  fuiAlLugar:         boolean("fui_al_lugar"),
  accionCorrectiva:   text("accion_correctiva"),
  decision:           text("decision"),                               // 'autorizado' | 'rechazado' | 'correccion'
  reviewNota:         text("review_nota"),
  reviewedAt:         timestamp("reviewed_at", { withTimezone: true, mode: "string" }),

  correctionDeclaredByUserId: text("correction_declared_by_user_id").references(() => users.id),
  correctionDeclaredAt: timestamp("correction_declared_at", { withTimezone: true, mode: "string" }),
  verifiedByUserId:   text("verified_by_user_id").references(() => users.id),
  verifiedAt:         timestamp("verified_at", { withTimezone: true, mode: "string" }),
  verificationComment:text("verification_comment"),
  authorizedByUserId: text("authorized_by_user_id").references(() => users.id),
  authorizedAt:       timestamp("authorized_at", { withTimezone: true, mode: "string" }),
  cancelledByUserId:  text("cancelled_by_user_id").references(() => users.id),
  cancelledAt:        timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  cancellationReason: text("cancellation_reason"),
  closedByUserId:     text("closed_by_user_id").references(() => users.id),
  closedAt:           timestamp("closed_at", { withTimezone: true, mode: "string" }),
  closeComment:       text("close_comment"),
  version:            integer("version").notNull().default(1),

  // Enlace opcional al permiso de trabajo bajo el cual se ejecuta la tarea.
  // La auditoría pide que el PPA sea una verificación breve dentro del flujo
  // de permisos, no un registro desconectado. Es nullable: el PPA sigue
  // funcionando de forma autónoma donde no se exige permiso.
  workPermitId:       text("work_permit_id"),

  /**
   * Momento en que el trabajador llenó el PPA en terreno, tomado del cliente.
   * `createdAt` es cuándo llegó al servidor: para un envío encolado offline
   * pueden ser días distintos, y el valor probatorio del PPA depende de haber
   * sido llenado ANTES de la tarea. Nulo en envíos en línea (donde coincide con
   * `createdAt`) y en clientes viejos que no lo mandan.
   */
  filledAt:           timestamp("filled_at", { withTimezone: true, mode: "string" }),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("idx_ppa_worksite_estado").on(table.worksiteId, table.estado),
  index("idx_ppa_created").on(table.createdAt),
  index("idx_ppa_worker").on(table.workerId, table.worksiteId),
  index("idx_ppa_work_permit").on(table.workPermitId),
  check("ppa_submissions_estado_check", sql`${table.estado} IN ('aprobado_auto', 'detenido', 'en_correccion', 'pendiente_verificacion', 'autorizado', 'rechazado', 'cancelado', 'cerrado')`),
  check("ppa_submissions_version_check", sql`${table.version} >= 1`),
  check("ppa_submissions_cancel_check", sql`(${table.cancelledAt} IS NULL AND ${table.cancelledByUserId} IS NULL AND ${table.cancellationReason} IS NULL) OR (${table.cancelledAt} IS NOT NULL AND ${table.cancelledByUserId} IS NOT NULL AND length(${table.cancellationReason}) >= 5)`),
  // Cada paso del flujo escribe su fecha JUNTO a su actor; una fecha sin actor
  // (o al revés) es un estado que ninguna transición puede producir, y sin CHECK
  // el esquema lo aceptaba igual. El trío de cancelación ya estaba cubierto
  // arriba; estos cuatro pares cierran la simetría.
  // `verification_comment` queda FUERA a propósito: una verificación rechazada
  // guarda el comentario con verified_at/verified_by en NULL (ver
  // verifyPpaCorrection), así que no es parte del par.
  check("ppa_submissions_correction_declared_check", sql`(${table.correctionDeclaredAt} IS NULL AND ${table.correctionDeclaredByUserId} IS NULL) OR (${table.correctionDeclaredAt} IS NOT NULL AND ${table.correctionDeclaredByUserId} IS NOT NULL)`),
  check("ppa_submissions_verified_check", sql`(${table.verifiedAt} IS NULL AND ${table.verifiedByUserId} IS NULL) OR (${table.verifiedAt} IS NOT NULL AND ${table.verifiedByUserId} IS NOT NULL)`),
  check("ppa_submissions_authorized_check", sql`(${table.authorizedAt} IS NULL AND ${table.authorizedByUserId} IS NULL) OR (${table.authorizedAt} IS NOT NULL AND ${table.authorizedByUserId} IS NOT NULL)`),
  check("ppa_submissions_closed_check", sql`(${table.closedAt} IS NULL AND ${table.closedByUserId} IS NULL) OR (${table.closedAt} IS NOT NULL AND ${table.closedByUserId} IS NOT NULL)`),
])

export const ppaStatusHistory = pgTable("ppa_status_history", {
  id:          text("id").primaryKey(),
  ppaId:       text("ppa_id").notNull().references(() => ppaSubmissions.id, { onDelete: "cascade" }),
  capaActionId:text("capa_action_id").references(() => preventionCapaActions.id, { onDelete: "restrict" }),
  fromStatus:  text("from_status"),
  toStatus:    text("to_status").notNull(),
  reason:      text("reason"),
  actorType:   text("actor_type").notNull().default("user"),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("ppa_status_history_ppa_created_idx").on(table.ppaId, table.createdAt),
  check("ppa_status_history_from_check", sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('aprobado_auto', 'detenido', 'en_correccion', 'pendiente_verificacion', 'autorizado', 'rechazado', 'cancelado', 'cerrado')`),
  check("ppa_status_history_to_check", sql`${table.toStatus} IN ('aprobado_auto', 'detenido', 'en_correccion', 'pendiente_verificacion', 'autorizado', 'rechazado', 'cancelado', 'cerrado')`),
  check("ppa_status_history_actor_check", sql`(${table.actorType} = 'system' AND ${table.actorUserId} IS NULL) OR (${table.actorType} = 'user' AND ${table.actorUserId} IS NOT NULL)`),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const ppaSubmissionsRelations = relations(ppaSubmissions, ({ one }) => ({
  worksite:      one(worksites, { fields: [ppaSubmissions.worksiteId], references: [worksites.id] }),
  worker:        one(workers,   { fields: [ppaSubmissions.workerId],   references: [workers.id] }),
  reviewedByUser: one(users,    { fields: [ppaSubmissions.reviewedBy], references: [users.id] }),
}))

export const ppaStatusHistoryRelations = relations(ppaStatusHistory, ({ one }) => ({
  ppa: one(ppaSubmissions, { fields: [ppaStatusHistory.ppaId], references: [ppaSubmissions.id] }),
  capaAction: one(preventionCapaActions, { fields: [ppaStatusHistory.capaActionId], references: [preventionCapaActions.id] }),
  actor: one(users, { fields: [ppaStatusHistory.actorUserId], references: [users.id] }),
}))

/* ── Inferred Types ──────────────────────────────────────────────────────── */
export type PpaSubmission    = typeof ppaSubmissions.$inferSelect
export type NewPpaSubmission = typeof ppaSubmissions.$inferInsert

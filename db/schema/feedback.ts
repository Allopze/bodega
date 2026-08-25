import { pgTable, text, timestamp, index, check } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { users } from "./users"

/* ── Feedback Reports ─────────────────────────────────────────────────────── */
// tipo:   'bug' | 'consulta' | 'sugerencia'
// estado: 'abierto' | 'en_progreso' | 'resuelto' | 'descartado'
export const feedbackReports = pgTable("feedback_reports", {
  id:           text("id").primaryKey(),
  tipo:         text("tipo").notNull(),
  titulo:       text("titulo").notNull(),
  descripcion:  text("descripcion").notNull(),
  pagina:       text("pagina"),                    // optional — URL/sección donde ocurrió
  priority:     text("priority").notNull().default("normal"),
  dueAt:        timestamp("due_at", { withTimezone: true, mode: "string" }),
  estado:       text("estado").notNull().default("abierto"),
  notaInterna:  text("nota_interna"),              // gestión interna, visible solo a admins
  createdBy:    text("created_by").notNull().references(() => users.id),
  resolvedBy:   text("resolved_by").references(() => users.id),
  resolvedAt:   timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("feedback_reports_tipo_valid", sql`${table.tipo} IN ('bug', 'consulta', 'sugerencia')`),
  check("feedback_reports_priority_valid", sql`${table.priority} IN ('baja', 'normal', 'alta', 'critica')`),
  check("feedback_reports_estado_valid", sql`${table.estado} IN ('abierto', 'en_progreso', 'resuelto', 'descartado')`),
  index("feedback_reports_created_by_idx").on(table.createdBy),
  index("feedback_reports_estado_idx").on(table.estado),
  index("feedback_reports_tipo_idx").on(table.tipo),
])

/* ── Feedback Report Events ─────────────────────────────────────────────── */
// Historial append-only: cada fila explica un cambio sin sobrescribir la nota
// o el estado que existía antes.
export const feedbackReportEvents = pgTable("feedback_report_events", {
  id:          text("id").primaryKey(),
  reportId:    text("report_id").notNull().references(() => feedbackReports.id, { onDelete: "cascade" }),
  eventType:   text("event_type").notNull(), // created | status_changed | note_added
  fromEstado:  text("from_estado"),
  toEstado:    text("to_estado"),
  note:        text("note"),                 // internal; never exposed to the reporter
  actorId:     text("actor_id").notNull().references(() => users.id),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("feedback_report_events_type_valid", sql`${table.eventType} IN ('created', 'status_changed', 'note_added')`),
  index("feedback_report_events_report_created_idx").on(table.reportId, table.createdAt),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const feedbackReportsRelations = relations(feedbackReports, ({ one, many }) => ({
  author:   one(users, { fields: [feedbackReports.createdBy],  references: [users.id], relationName: "report_author"   }),
  resolver: one(users, { fields: [feedbackReports.resolvedBy], references: [users.id], relationName: "report_resolver" }),
  events: many(feedbackReportEvents),
}))

export const feedbackReportEventsRelations = relations(feedbackReportEvents, ({ one }) => ({
  report: one(feedbackReports, { fields: [feedbackReportEvents.reportId], references: [feedbackReports.id] }),
  actor: one(users, { fields: [feedbackReportEvents.actorId], references: [users.id] }),
}))

/* ── Inferred types ──────────────────────────────────────────────────────── */
export type FeedbackReport    = typeof feedbackReports.$inferSelect
export type NewFeedbackReport = typeof feedbackReports.$inferInsert
export type FeedbackReportEvent = typeof feedbackReportEvents.$inferSelect

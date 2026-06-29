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

/* ── Relations ───────────────────────────────────────────────────────────── */
export const feedbackReportsRelations = relations(feedbackReports, ({ one }) => ({
  author:   one(users, { fields: [feedbackReports.createdBy],  references: [users.id], relationName: "report_author"   }),
  resolver: one(users, { fields: [feedbackReports.resolvedBy], references: [users.id], relationName: "report_resolver" }),
}))

/* ── Inferred types ──────────────────────────────────────────────────────── */
export type FeedbackReport    = typeof feedbackReports.$inferSelect
export type NewFeedbackReport = typeof feedbackReports.$inferInsert

import { relations, sql } from "drizzle-orm"
import { check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"

/* ── Campañas Preventivas (R9 - Actividades PDTP 85, 86, 87, 89) ────────────
 * Simplificación 2026-09-14: el modelo anterior tenía un ciclo de vida de 4
 * estados (draft/active/completed/cancelled) y una tabla de asistencia con
 * una fila por trabajador que participó — para una obligación que, según el
 * Anexo A del PDTP, se acredita con "difusión con evidencia de asistencia
 * masiva", no con el registro nominal de cada persona. Nadie fuera de este
 * módulo consumía la asistencia individual.
 *
 * Queda como "se hizo / no se hizo" + evidencia: una campaña está `pending`
 * hasta que alguien la marca `done` con su evidencia de difusión (foto, lista
 * de asistencia escaneada, acta). Es el mismo mecanismo que el resto del
 * módulo usa para actividades de constancia, aplicado dentro de esta tabla en
 * vez de la genérica — Campañas conserva su propia ruta y su propio ciclo de
 * vida porque además declara qué actividad del PDTP acredita cada campaña,
 * algo que la constancia genérica no necesita resolver.
 */
export const preventionCampaigns = pgTable("prevention_campaigns", {
  id:                  text("id").primaryKey(),
  worksiteId:          text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  code:                text("code").notNull().unique(),
  title:               text("title").notNull(),
  description:         text("description"),
  status:              text("status").notNull().default("pending"),
  pdtpActivityNumbers: jsonb("pdtp_activity_numbers").$type<number[]>().notNull().default([85]),
  evidenceUrl:         text("evidence_url"),
  /**
   * Fecha civil en que se hizo la campaña — no cuándo se registró.
   *
   * `completedAt` es el timestamp de la digitación; con él como `occurredAt`,
   * una campaña de marzo marcada en mayo acreditaba mayo, y el PDTP mide por
   * mes y semana. Es `text` (`YYYY-MM-DD`) como el resto de las fechas civiles
   * del módulo (`constitutedOn`, `measuredOn`): un timestamp obligaría a
   * decidir una hora que el hecho no tiene, y a medianoche UTC el día cae en
   * el anterior en Chile.
   */
  heldOn:              text("held_on"),
  completedAt:         timestamp("completed_at", { withTimezone: true, mode: "string" }),
  completedByUserId:   text("completed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  createdByUserId:     text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_campaign_worksite_idx").on(table.worksiteId, table.status),
  check("prevention_campaign_status_check", sql`${table.status} IN ('pending', 'done')`),
  // Hecha sin evidencia no es evidencia oponible ante un fiscalizador; los
  // tres campos de cierre van juntos o ninguno, mismo patrón que el resto del
  // módulo (`prevention_external_engagement_closed_consistent`,
  // `prevention_emergency_drill_completed_consistent`).
  check("prevention_campaign_done_consistent", sql`
    (${table.status} = 'pending' AND ${table.completedAt} IS NULL AND ${table.completedByUserId} IS NULL AND ${table.evidenceUrl} IS NULL AND ${table.heldOn} IS NULL)
    OR (${table.status} = 'done' AND ${table.completedAt} IS NOT NULL AND ${table.completedByUserId} IS NOT NULL AND ${table.evidenceUrl} IS NOT NULL AND ${table.heldOn} IS NOT NULL)
  `),
])

export const preventionCampaignsRelations = relations(preventionCampaigns, ({ one }) => ({
  worksite: one(worksites, { fields: [preventionCampaigns.worksiteId], references: [worksites.id] }),
  createdByUser: one(users, { fields: [preventionCampaigns.createdByUserId], references: [users.id] }),
  completedByUser: one(users, { fields: [preventionCampaigns.completedByUserId], references: [users.id] }),
}))

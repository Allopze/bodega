import { sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"

/* ── Interacciones preventivas con externos ───────────────────────────────
 * Una sola tabla para tres obligaciones que comparten forma: alguien de fuera
 * de la empresa interactúa con la faena en materia preventiva, queda un acta y
 * de ahí salen compromisos con plazo.
 *
 *  · `coordinacion`            DS 44 art. 20 — coordinación de la actividad
 *                              preventiva cuando dos o más empleadores
 *                              comparten el lugar de trabajo.
 *  · `fiscalizacion`           Visita de la Dirección del Trabajo o la SEREMI
 *                              de Salud.
 *  · `organismo_administrador` Visita de la mutualidad (ACHS/IST/Mutual/ISL).
 *                              Sus prescripciones son obligatorias, art. 70.
 *
 * Tres tablas serían tres servicios, tres páginas y tres `sourceType` para el
 * mismo formulario. Lo que de verdad las distingue es la dirección: el art. 20
 * es simétrico —hay que informar *y* ser informado— mientras que una
 * fiscalización sólo se recibe. Eso lo fija un check, no un esquema aparte.
 *
 * Los compromisos y medidas prescritas NO viven acá: cada uno es una acción
 * correctiva con `sourceType: 'external_engagement'`. CAPA ya tiene hallazgo,
 * responsable, plazo, verificación y evaluación de eficacia; una tabla propia
 * de compromisos sería un CAPA peor.
 */
export const preventionExternalEngagements = pgTable("prevention_external_engagements", {
  id:          text("id").primaryKey(),
  code:        text("code").notNull().unique(),
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  kind:        text("kind").notNull(),
  /** `received` = la contraparte nos informó o fiscalizó; `delivered` = le
   *  entregamos nuestra información preventiva. Sólo la coordinación del
   *  art. 20 puede ser `delivered`. */
  direction:   text("direction").notNull().default("received"),
  counterpartyType: text("counterparty_type").notNull(),
  counterpartyName: text("counterparty_name").notNull(),
  counterpartyRut:  text("counterparty_rut"),
  occurredOn:  text("occurred_on").notNull(),
  subject:     text("subject").notNull(),
  summary:     text("summary"),
  outcome:     text("outcome"),
  /** N° de acta, resolución o comprobante. Obligatorio salvo en coordinación,
   *  que muchas veces es un correo o una reunión sin folio. */
  officialReference: text("official_reference"),
  /** Qué se informó, sólo para la coordinación del art. 20. */
  infoTypes:   jsonb("info_types").$type<string[]>(),
  closedAt:    timestamp("closed_at", { withTimezone: true, mode: "string" }),
  closedByUserId: text("closed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  version:     integer("version").notNull().default(1),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_external_engagement_worksite_idx").on(table.worksiteId, table.occurredOn),
  index("prevention_external_engagement_kind_idx").on(table.kind, table.occurredOn),
  check("prevention_external_engagement_kind_valid", sql`${table.kind} IN ('coordinacion', 'fiscalizacion', 'organismo_administrador')`),
  check("prevention_external_engagement_direction_valid", sql`${table.direction} IN ('received', 'delivered')`),
  // Una fiscalización o una visita de la mutualidad nunca se "entrega": sólo la
  // coordinación del art. 20 es bidireccional.
  check("prevention_external_engagement_direction_consistent", sql`${table.kind} = 'coordinacion' OR ${table.direction} = 'received'`),
  check("prevention_external_engagement_counterparty_valid", sql`${table.counterpartyType} IN ('mandante', 'contratista', 'subcontratista', 'otra_empresa_faena', 'direccion_trabajo', 'seremi_salud', 'organismo_administrador', 'otro')`),
  // Sin folio no hay cómo acreditar una fiscalización ante la propia autoridad.
  check("prevention_external_engagement_reference_required", sql`${table.kind} = 'coordinacion' OR length(trim(COALESCE(${table.officialReference}, ''))) >= 3`),
  check("prevention_external_engagement_closed_consistent", sql`(${table.closedAt} IS NULL AND ${table.closedByUserId} IS NULL) OR (${table.closedAt} IS NOT NULL AND ${table.closedByUserId} IS NOT NULL)`),
  check("prevention_external_engagement_version_positive", sql`${table.version} >= 1`),
])


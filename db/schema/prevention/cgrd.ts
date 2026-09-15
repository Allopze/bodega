import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { workers, worksites } from "../worksites"
import { preventionCapaActions } from "./capa"
import { preventionEmergencyScenarios } from "./emergency"

/* ── Comité de Gestión de Riesgos de Desastres (G15, DS 44) ────────────────
 * Distinto del Comité Paritario: el DS 44 exige un órgano propio para riesgo
 * de desastres, no reutilizable con el CPHS aunque el molde estructural
 * (constitución por faena, integrantes, vigencia) sea el mismo.
 *
 * Corresponde **desde 26 personas** en el centro de trabajo; hasta 25 la
 * figura es el coordinador (`prevention_grd_coordinators`). El umbral y la
 * regla viven en `lib/prevention/cgrd.ts`.
 *
 * Simplificación 2026-09-14: se le agregó `evidenceUrl`. Antes la N°79 se
 * acreditaba con un rótulo sintético ("Comité constituido: <id>") — la
 * constitución nunca tuvo dónde adjuntar el acta que la acredita ante un
 * fiscalizador.
 */
export const preventionGrdCommittees = pgTable("prevention_grd_committees", {
  id:              text("id").primaryKey(),
  worksiteId:      text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  name:            text("name").notNull(),
  constitutedOn:   text("constituted_on").notNull(),
  mandateEndsOn:   text("mandate_ends_on").notNull(),
  status:          text("status").notNull().default("active"),
  evidenceUrl:     text("evidence_url").notNull(),
  version:         integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_grd_committee_active_worksite_unique").on(table.worksiteId)
    .where(sql`${table.status} = 'active'`),
  check("prevention_grd_committee_status_valid", sql`${table.status} IN ('active', 'dissolved', 'expired')`),
  check("prevention_grd_committee_mandate_valid", sql`${table.mandateEndsOn} > ${table.constitutedOn}`),
  check("prevention_grd_committee_version_positive", sql`${table.version} >= 1`),
])

/* ── Coordinador de Gestión del Riesgo de Desastres ───────────────────────
 * Hasta 25 personas en el centro de trabajo corresponde designar un
 * coordinador; desde 26 corresponde constituir el comité (umbral en
 * `lib/prevention/cgrd.ts`). Es el mismo patrón estructural que el delegado
 * del CPHS (`prevention_worksite_delegates`), pero **otra figura**: el
 * delegado de SST es de otro cuerpo normativo, aplica entre 10 y 25 cuando no
 * hay Comité Paritario, y las dos pueden coexistir en la misma faena.
 */
export const preventionGrdCoordinators = pgTable("prevention_grd_coordinators", {
  id:              text("id").primaryKey(),
  worksiteId:      text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  workerId:        text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  designatedOn:    text("designated_on").notNull(),
  status:          text("status").notNull().default("active"),
  evidenceUrl:     text("evidence_url").notNull(),
  endedReason:     text("ended_reason"),
  endedAt:         timestamp("ended_at", { withTimezone: true, mode: "string" }),
  version:         integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_grd_coordinator_active_unique").on(table.worksiteId)
    .where(sql`${table.status} = 'active'`),
  check("prevention_grd_coordinator_status_valid", sql`${table.status} IN ('active', 'ended')`),
  check("prevention_grd_coordinator_end_consistent", sql`(${table.endedAt} IS NULL AND ${table.endedReason} IS NULL) OR (${table.endedAt} IS NOT NULL AND length(${table.endedReason}) >= 10)`),
  check("prevention_grd_coordinator_version_positive", sql`${table.version} >= 1`),
])

export const preventionGrdMembers = pgTable("prevention_grd_members", {
  id:          text("id").primaryKey(),
  committeeId: text("committee_id").notNull().references(() => preventionGrdCommittees.id, { onDelete: "cascade" }),
  workerId:    text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  role:        text("role"),
  status:      text("status").notNull().default("active"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_grd_member_unique").on(table.committeeId, table.workerId)
    .where(sql`${table.status} = 'active'`),
  index("prevention_grd_member_committee_idx").on(table.committeeId, table.status),
  check("prevention_grd_member_role_valid", sql`${table.role} IS NULL OR ${table.role} IN ('presidente', 'secretario', 'integrante')`),
  check("prevention_grd_member_status_valid", sql`${table.status} IN ('active', 'replaced', 'resigned')`),
])

/*
 * Matriz GRD (N°80).
 *
 * Simplificación 2026-09-14: de 6 estados con 3 firmas segregadas (revisión,
 * aprobación, publicación) + hash del contenido, a 2 estados (`draft` →
 * `published`) con una sola persona que publica adjuntando la evidencia real
 * —el documento de la matriz— en vez de una huella SHA-256 sobre filas de la
 * base que nadie podía abrir ni mostrarle a un fiscalizador. `revisionReason`
 * se conserva: sigue siendo útil saber por qué se abrió una versión nueva,
 * aunque ya no la revise una segunda persona antes de publicarla.
 */
export const preventionGrdMatrices = pgTable("prevention_grd_matrices", {
  id:                  text("id").primaryKey(),
  worksiteId:          text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  matrixVersion:       integer("matrix_version").notNull(),
  title:               text("title").notNull(),
  status:              text("status").notNull().default("draft"),
  revisionReason:      text("revision_reason").notNull(),
  evidenceUrl:         text("evidence_url"),
  publishedByUserId:   text("published_by_user_id").references(() => users.id),
  publishedAt:         timestamp("published_at", { withTimezone: true, mode: "string" }),
  version:             integer("version").notNull().default(1),
  createdByUserId:     text("created_by_user_id").notNull().references(() => users.id),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_grd_matrices_scope_version_unique").on(table.worksiteId, table.matrixVersion),
  index("prevention_grd_matrices_scope_status_idx").on(table.worksiteId, table.status),
  uniqueIndex("prevention_grd_matrices_one_published_scope_unique").on(table.worksiteId).where(sql`${table.status} = 'published'`),
  check("prevention_grd_matrices_status_valid", sql`${table.status} IN ('draft', 'published', 'superseded')`),
  check("prevention_grd_matrices_version_positive", sql`${table.matrixVersion} > 0 AND ${table.version} > 0`),
  check("prevention_grd_matrices_publish_evidence", sql`${table.status} = 'draft' OR (${table.publishedByUserId} IS NOT NULL AND ${table.publishedAt} IS NOT NULL AND ${table.evidenceUrl} IS NOT NULL)`),
])

/*
 * Amenazas — tabla propia, no el enum cerrado de
 * `prevention_emergency_scenarios.type`: la N°80 exige análisis histórico,
 * evaluación legal y plan de trabajo por amenaza, que ese catálogo no tiene
 * dónde guardar, y distingue obligatoria de detectada, que tampoco.
 * `emergencyScenarioId` es el puente opcional al componente 5 (plan de
 * emergencia por amenaza): la matriz REFERENCIA el escenario ya aprobado en
 * el plan de emergencia, no lo duplica (la N°83 sigue acreditando aparte,
 * contando escenarios, desde `onEmergencyPlanApproved`).
 */
export const preventionGrdThreats = pgTable("prevention_grd_threats", {
  id:                  text("id").primaryKey(),
  matrixId:            text("matrix_id").notNull().references(() => preventionGrdMatrices.id, { onDelete: "cascade" }),
  name:                text("name").notNull(),
  origin:              text("origin").notNull(),
  historicalAnalysis:  text("historical_analysis").notNull(),
  legalRequirement:    text("legal_requirement").notNull(),
  workPlan:            text("work_plan").notNull(),
  emergencyScenarioId: text("emergency_scenario_id").references(() => preventionEmergencyScenarios.id, { onDelete: "set null" }),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_grd_threat_matrix_idx").on(table.matrixId),
  check("prevention_grd_threat_origin_valid", sql`${table.origin} IN ('obligatoria', 'detectada')`),
  check("prevention_grd_threat_name_valid", sql`length(${table.name}) >= 3`),
  check("prevention_grd_threat_historical_analysis_valid", sql`length(${table.historicalAnalysis}) >= 10`),
  check("prevention_grd_threat_legal_requirement_valid", sql`length(${table.legalRequirement}) >= 10`),
  check("prevention_grd_threat_work_plan_valid", sql`length(${table.workPlan}) >= 10`),
])

/* ── Actas de reunión CGRD (N°81) ───────────────────────────────────────────
 * Simplificación 2026-09-14: de convocar→cerrar/cancelar (3 estados, dos
 * actos separados) a un solo registro — el acta se carga después de la
 * sesión, como el resto de las constancias del módulo, con su evidencia. Sin
 * programación previa: la N°81 acredita el acta cerrada, no la convocatoria.
 *
 * A diferencia del CPHS, que no acredita su reunión mensual porque esa
 * actividad salió del PDTP (D5), la N°81 sí acredita por acta cerrada: el
 * catálogo la declara como actividad propia del programa.
 */
export const preventionGrdMeetings = pgTable("prevention_grd_meetings", {
  id:              text("id").primaryKey(),
  code:            text("code").notNull().unique(),
  committeeId:     text("committee_id").notNull().references(() => preventionGrdCommittees.id, { onDelete: "cascade" }),
  heldOn:          timestamp("held_on", { withTimezone: true, mode: "string" }).notNull(),
  agenda:          text("agenda").notNull(),
  minutes:         text("minutes").notNull(),
  quorumReached:   boolean("quorum_reached").notNull().default(false),
  evidenceUrl:     text("evidence_url").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_grd_meeting_committee_idx").on(table.committeeId, table.heldOn),
  check("prevention_grd_meeting_minutes_valid", sql`length(${table.minutes}) >= 20`),
])

/* ── Acuerdos del acta ─────────────────────────────────────────────────────
 * Mismo criterio que `prevention_committee_agreements` del CPHS: todo acuerdo
 * con responsable y plazo se deriva a CAPA común, porque un acuerdo sin acción
 * trazable no es seguimiento, es una nota. Y sin columna `status`: el estado
 * del acuerdo ES el de su CAPA — decisión "CAPA motor único", que prohíbe el
 * espejo porque se desincroniza y miente.
 */
export const preventionGrdAgreements = pgTable("prevention_grd_agreements", {
  id:           text("id").primaryKey(),
  meetingId:    text("meeting_id").notNull().references(() => preventionGrdMeetings.id, { onDelete: "cascade" }),
  description:  text("description").notNull(),
  capaActionId: text("capa_action_id").references(() => preventionCapaActions.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_grd_agreement_meeting_idx").on(table.meetingId),
  check("prevention_grd_agreement_description_valid", sql`length(${table.description}) >= 5`),
])

/* ── Relations ──────────────────────────────────────────────────────────── */
export const preventionGrdCommitteesRelations = relations(preventionGrdCommittees, ({ one, many }) => ({
  worksite: one(worksites, { fields: [preventionGrdCommittees.worksiteId], references: [worksites.id] }),
  members: many(preventionGrdMembers),
  meetings: many(preventionGrdMeetings),
}))

export const preventionGrdMembersRelations = relations(preventionGrdMembers, ({ one }) => ({
  committee: one(preventionGrdCommittees, { fields: [preventionGrdMembers.committeeId], references: [preventionGrdCommittees.id] }),
  worker: one(workers, { fields: [preventionGrdMembers.workerId], references: [workers.id] }),
}))

export const preventionGrdMatricesRelations = relations(preventionGrdMatrices, ({ one, many }) => ({
  worksite: one(worksites, { fields: [preventionGrdMatrices.worksiteId], references: [worksites.id] }),
  threats: many(preventionGrdThreats),
}))

export const preventionGrdThreatsRelations = relations(preventionGrdThreats, ({ one }) => ({
  matrix: one(preventionGrdMatrices, { fields: [preventionGrdThreats.matrixId], references: [preventionGrdMatrices.id] }),
  emergencyScenario: one(preventionEmergencyScenarios, { fields: [preventionGrdThreats.emergencyScenarioId], references: [preventionEmergencyScenarios.id] }),
}))

export const preventionGrdMeetingsRelations = relations(preventionGrdMeetings, ({ one, many }) => ({
  committee: one(preventionGrdCommittees, { fields: [preventionGrdMeetings.committeeId], references: [preventionGrdCommittees.id] }),
  agreements: many(preventionGrdAgreements),
}))

export const preventionGrdCoordinatorsRelations = relations(preventionGrdCoordinators, ({ one }) => ({
  worksite: one(worksites, { fields: [preventionGrdCoordinators.worksiteId], references: [worksites.id] }),
  worker: one(workers, { fields: [preventionGrdCoordinators.workerId], references: [workers.id] }),
}))

export const preventionGrdAgreementsRelations = relations(preventionGrdAgreements, ({ one }) => ({
  meeting: one(preventionGrdMeetings, { fields: [preventionGrdAgreements.meetingId], references: [preventionGrdMeetings.id] }),
  capaAction: one(preventionCapaActions, { fields: [preventionGrdAgreements.capaActionId], references: [preventionCapaActions.id] }),
}))

export type PreventionGrdCommittee = typeof preventionGrdCommittees.$inferSelect
export type PreventionGrdMember = typeof preventionGrdMembers.$inferSelect
export type PreventionGrdMatrix = typeof preventionGrdMatrices.$inferSelect
export type PreventionGrdThreat = typeof preventionGrdThreats.$inferSelect
export type PreventionGrdMeeting = typeof preventionGrdMeetings.$inferSelect
export type PreventionGrdAgreement = typeof preventionGrdAgreements.$inferSelect
export type PreventionGrdCoordinator = typeof preventionGrdCoordinators.$inferSelect

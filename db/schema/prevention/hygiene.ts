import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { workers, worksites } from "../worksites"
import { preventionHealthRecords } from "./privacy"
import { preventionRiskEntries } from "./risk-legal"

/* ── Agentes de exposición ────────────────────────────────────────────────
 * El límite permisible y el nivel de acción son parámetros normativos por
 * agente (DS 594 y protocolos aplicables), no constantes de código: se
 * declaran con su fuente para que Prevención pueda mantenerlos.
 */
export const preventionExposureAgents = pgTable("prevention_exposure_agents", {
  id:                 text("id").primaryKey(),
  code:               text("code").notNull().unique(),
  name:               text("name").notNull(),
  agentType:          text("agent_type").notNull(),
  unit:               text("unit").notNull(),
  permissibleLimit:   numeric("permissible_limit", { precision: 14, scale: 4 }),
  actionLevelFactor:  numeric("action_level_factor", { precision: 5, scale: 4 }).notNull().default("0.5"),
  limitBasis:         text("limit_basis").notNull(),
  surveillanceProtocol: text("surveillance_protocol"),
  isActive:           boolean("is_active").notNull().default(true),
  createdByUserId:    text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_exposure_agent_type_idx").on(table.agentType, table.isActive),
  check("prevention_exposure_agent_type_valid", sql`${table.agentType} IN ('chemical', 'physical', 'biological', 'ergonomic', 'psychosocial')`),
  check("prevention_exposure_agent_basis_valid", sql`length(${table.limitBasis}) >= 5`),
  check("prevention_exposure_agent_action_factor_valid", sql`${table.actionLevelFactor} > 0 AND ${table.actionLevelFactor} <= 1`),
  check("prevention_exposure_agent_limit_positive", sql`${table.permissibleLimit} IS NULL OR ${table.permissibleLimit} > 0`),
])

/* ── Grupo de exposición similar (GES) ────────────────────────────────────
 * Es la unidad de la higiene industrial: personas que comparten agente,
 * proceso y condiciones, de modo que una medición representa a todas.
 */
export const preventionExposureGroups = pgTable("prevention_exposure_groups", {
  id:               text("id").primaryKey(),
  code:             text("code").notNull().unique(),
  name:             text("name").notNull(),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  agentId:          text("agent_id").notNull().references(() => preventionExposureAgents.id, { onDelete: "restrict" }),
  processDescription: text("process_description").notNull(),
  riskEntryId:      text("risk_entry_id").references(() => preventionRiskEntries.id, { onDelete: "set null" }),
  surveillanceRequired: boolean("surveillance_required").notNull().default(false),
  surveillanceReason: text("surveillance_reason"),
  isActive:         boolean("is_active").notNull().default(true),
  version:          integer("version").notNull().default(1),
  createdByUserId:  text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_exposure_group_worksite_idx").on(table.worksiteId, table.isActive),
  index("prevention_exposure_group_agent_idx").on(table.agentId),
  check("prevention_exposure_group_surveillance_consistent", sql`${table.surveillanceRequired} = false OR length(${table.surveillanceReason}) >= 10`),
  check("prevention_exposure_group_version_positive", sql`${table.version} >= 1`),
])

export const preventionExposureGroupMembers = pgTable("prevention_exposure_group_members", {
  id:        text("id").primaryKey(),
  groupId:   text("group_id").notNull().references(() => preventionExposureGroups.id, { onDelete: "cascade" }),
  workerId:  text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  joinedOn:  text("joined_on").notNull(),
  leftOn:    text("left_on"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_exposure_group_member_unique").on(table.groupId, table.workerId)
    .where(sql`${table.leftOn} IS NULL`),
  index("prevention_exposure_group_member_worker_idx").on(table.workerId),
  check("prevention_exposure_group_member_dates_valid", sql`${table.leftOn} IS NULL OR ${table.leftOn} >= ${table.joinedOn}`),
])

/* ── Mediciones ───────────────────────────────────────────────────────────
 * La comparación contra el límite se persiste junto al resultado: la decisión
 * de vigilancia no debe depender de recalcular límites que pudieron cambiar.
 */
export const preventionExposureMeasurements = pgTable("prevention_exposure_measurements", {
  id:                text("id").primaryKey(),
  groupId:           text("group_id").notNull().references(() => preventionExposureGroups.id, { onDelete: "cascade" }),
  measuredOn:        text("measured_on").notNull(),
  value:             numeric("value", { precision: 14, scale: 4 }).notNull(),
  unit:              text("unit").notNull(),
  permissibleLimitSnapshot: numeric("permissible_limit_snapshot", { precision: 14, scale: 4 }),
  actionLevelSnapshot: numeric("action_level_snapshot", { precision: 14, scale: 4 }),
  outcome:           text("outcome").notNull(),
  method:            text("method").notNull(),
  laboratoryName:    text("laboratory_name"),
  equipmentTag:      text("equipment_tag").notNull(),
  calibrationDate:   text("calibration_date"),
  sampleDurationMinutes: integer("sample_duration_minutes"),
  reportReference:   text("report_reference"),
  recordedByUserId:  text("recorded_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_exposure_measurement_group_idx").on(table.groupId, table.measuredOn),
  check("prevention_exposure_measurement_outcome_valid", sql`${table.outcome} IN ('below_action', 'above_action', 'above_limit', 'not_comparable')`),
  check("prevention_exposure_measurement_value_nonnegative", sql`${table.value} >= 0`),
  check("prevention_exposure_measurement_duration_valid", sql`${table.sampleDurationMinutes} IS NULL OR ${table.sampleDurationMinutes} > 0`),
])

/* ── Programas de vigilancia ──────────────────────────────────────────────
 * El resultado clínico NO vive aquí: la matrícula enlaza al registro de salud
 * cifrado que ya existe. Aquí sólo vive el control del proceso.
 */
export const preventionSurveillancePrograms = pgTable("prevention_surveillance_programs", {
  id:               text("id").primaryKey(),
  code:             text("code").notNull().unique(),
  name:             text("name").notNull(),
  protocol:         text("protocol").notNull(),
  agentId:          text("agent_id").references(() => preventionExposureAgents.id, { onDelete: "set null" }),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  periodicityMonths: integer("periodicity_months").notNull(),
  legalBasis:       text("legal_basis").notNull(),
  status:           text("status").notNull().default("active"),
  createdByUserId:  text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_surveillance_program_worksite_idx").on(table.worksiteId, table.status),
  check("prevention_surveillance_program_status_valid", sql`${table.status} IN ('active', 'suspended', 'closed')`),
  check("prevention_surveillance_program_periodicity_valid", sql`${table.periodicityMonths} > 0 AND ${table.periodicityMonths} <= 120`),
  check("prevention_surveillance_program_basis_valid", sql`length(${table.legalBasis}) >= 5`),
])

export const preventionSurveillanceEnrollments = pgTable("prevention_surveillance_enrollments", {
  id:               text("id").primaryKey(),
  programId:        text("program_id").notNull().references(() => preventionSurveillancePrograms.id, { onDelete: "cascade" }),
  workerId:         text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  groupId:          text("group_id").references(() => preventionExposureGroups.id, { onDelete: "set null" }),
  enrolledOn:       text("enrolled_on").notNull(),
  dueOn:            text("due_on").notNull(),
  status:           text("status").notNull().default("pending"),
  summonedAt:       timestamp("summoned_at", { withTimezone: true, mode: "string" }),
  attendedOn:       text("attended_on"),
  healthRecordId:   text("health_record_id").references(() => preventionHealthRecords.id, { onDelete: "set null" }),
  absenceReason:    text("absence_reason"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_surveillance_enrollment_unique").on(table.programId, table.workerId, table.dueOn),
  index("prevention_surveillance_enrollment_due_idx").on(table.dueOn, table.status),
  check("prevention_surveillance_enrollment_status_valid", sql`${table.status} IN ('pending', 'summoned', 'attended', 'absent', 'exempt')`),
  check("prevention_surveillance_enrollment_attended_consistent", sql`${table.status} <> 'attended' OR ${table.attendedOn} IS NOT NULL`),
  check("prevention_surveillance_enrollment_absent_consistent", sql`${table.status} <> 'absent' OR length(${table.absenceReason}) >= 5`),
])

/* ── Historial inmutable ──────────────────────────────────────────────────── */
export const preventionHygieneHistory = pgTable("prevention_hygiene_history", {
  id:          text("id").primaryKey(),
  entityType:  text("entity_type").notNull(),
  entityId:    text("entity_id").notNull(),
  worksiteId:  text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  changeType:  text("change_type").notNull(),
  reason:      text("reason").notNull(),
  beforeState: jsonb("before_state"),
  afterState:  jsonb("after_state"),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_hygiene_history_entity_idx").on(table.entityType, table.entityId, table.createdAt),
])

/* ── Aplicabilidad de los protocolos MINSAL por faena ─────────────────────
 * El catálogo de protocolos (PREXOR, psicosocial, sílice, hiperbaria,
 * frío/calor, citostáticos, UV, TMERT) es una constante de código —
 * `lib/prevention/minsal-protocols.ts` — porque sólo cambia cuando cambia una
 * resolución del MINSAL. Lo que sí es dato de la empresa es el pronunciamiento
 * de cada faena: aplica, no aplica y por qué, y cuándo toca reevaluarlo.
 *
 * Hasta ahora el protocolo era texto libre en `preventionExposureAgents
 * .surveillanceProtocol` y `preventionSurveillancePrograms.protocol`. Esas
 * columnas se conservan y siguen sin `check` SQL a propósito: hay datos
 * legados con texto libre, y la validación contra el catálogo vive en Zod.
 */
export const preventionProtocolApplicabilities = pgTable("prevention_protocol_applicabilities", {
  id:                text("id").primaryKey(),
  protocolCode:      text("protocol_code").notNull(),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  status:            text("status").notNull().default("pending_assessment"),
  /** Por qué se descarta. Obligatoria si `status = 'not_applicable'`. */
  justification:     text("justification"),
  periodicityMonths: integer("periodicity_months"),
  lastAssessedOn:    text("last_assessed_on"),
  nextAssessmentOn:  text("next_assessment_on"),
  assessedByUserId:  text("assessed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  version:           integer("version").notNull().default(1),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_protocol_applicability_unique").on(table.worksiteId, table.protocolCode),
  index("prevention_protocol_applicability_due_idx").on(table.nextAssessmentOn),
  check("prevention_protocol_applicability_status_valid", sql`${table.status} IN ('applicable', 'not_applicable', 'pending_assessment')`),
  // Descartar un protocolo obligatorio sin decir por qué es exactamente lo que
  // se sanciona en una fiscalización.
  check("prevention_protocol_applicability_justification_required", sql`${table.status} <> 'not_applicable' OR length(trim(COALESCE(${table.justification}, ''))) >= 10`),
  check("prevention_protocol_applicability_version_positive", sql`${table.version} >= 1`),
])

/* ── Relations ────────────────────────────────────────────────────────────── */
export const preventionExposureGroupsRelations = relations(preventionExposureGroups, ({ one, many }) => ({
  agent: one(preventionExposureAgents, { fields: [preventionExposureGroups.agentId], references: [preventionExposureAgents.id] }),
  worksite: one(worksites, { fields: [preventionExposureGroups.worksiteId], references: [worksites.id] }),
  members: many(preventionExposureGroupMembers),
  measurements: many(preventionExposureMeasurements),
}))

export const preventionExposureGroupMembersRelations = relations(preventionExposureGroupMembers, ({ one }) => ({
  group: one(preventionExposureGroups, { fields: [preventionExposureGroupMembers.groupId], references: [preventionExposureGroups.id] }),
  worker: one(workers, { fields: [preventionExposureGroupMembers.workerId], references: [workers.id] }),
}))

export const preventionExposureMeasurementsRelations = relations(preventionExposureMeasurements, ({ one }) => ({
  group: one(preventionExposureGroups, { fields: [preventionExposureMeasurements.groupId], references: [preventionExposureGroups.id] }),
}))

export const preventionSurveillanceProgramsRelations = relations(preventionSurveillancePrograms, ({ one, many }) => ({
  agent: one(preventionExposureAgents, { fields: [preventionSurveillancePrograms.agentId], references: [preventionExposureAgents.id] }),
  worksite: one(worksites, { fields: [preventionSurveillancePrograms.worksiteId], references: [worksites.id] }),
  enrollments: many(preventionSurveillanceEnrollments),
}))

export const preventionSurveillanceEnrollmentsRelations = relations(preventionSurveillanceEnrollments, ({ one }) => ({
  program: one(preventionSurveillancePrograms, { fields: [preventionSurveillanceEnrollments.programId], references: [preventionSurveillancePrograms.id] }),
  worker: one(workers, { fields: [preventionSurveillanceEnrollments.workerId], references: [workers.id] }),
  healthRecord: one(preventionHealthRecords, { fields: [preventionSurveillanceEnrollments.healthRecordId], references: [preventionHealthRecords.id] }),
}))

export type PreventionExposureAgent = typeof preventionExposureAgents.$inferSelect
export type PreventionExposureGroup = typeof preventionExposureGroups.$inferSelect
export type PreventionExposureMeasurement = typeof preventionExposureMeasurements.$inferSelect
export type PreventionSurveillanceProgram = typeof preventionSurveillancePrograms.$inferSelect
export type PreventionSurveillanceEnrollment = typeof preventionSurveillanceEnrollments.$inferSelect
export type PreventionProtocolApplicability = typeof preventionProtocolApplicabilities.$inferSelect

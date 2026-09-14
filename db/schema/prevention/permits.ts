import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { workers, worksites } from "../worksites"
import { preventionRiskEntries } from "./risk-legal"

/* ── Tipos de permiso configurables ───────────────────────────────────────
 * El catálogo no se hardcodea: Chome y cada mandante definen qué tareas
 * exigen permiso. `competencyTaskKey` enlaza con los requisitos de competencia
 * de alcance `task` ya existentes, en vez de crear un segundo motor de
 * habilitación.
 */
export const preventionPermitTypes = pgTable("prevention_permit_types", {
  id:                     text("id").primaryKey(),
  code:                   text("code").notNull().unique(),
  name:                   text("name").notNull(),
  description:            text("description"),
  competencyTaskKey:      text("competency_task_key"),
  requiresIsolation:      boolean("requires_isolation").notNull().default(false),
  requiresMeasurement:    boolean("requires_measurement").notNull().default(false),
  requiresJsa:            boolean("requires_jsa").notNull().default(true),
  /*
   * PER-001 (auditoría 2026-09-14): el acuse del AST por la cuadrilla existía
   * —firmado, de un solo uso— pero era decorativo: el permiso pasaba a `active`
   * con cero acuses, mientras los otros doce bloqueadores sí impedían activar.
   * Acá el acuse se vuelve un bloqueador **configurable por tipo**, la salida
   * que sanciona el plan de remediación (tanda 5, fila 27). La migración
   * 0282 respalda el valor de `requires_jsa` en las filas existentes: un tipo
   * que no exige AST no empieza a exigir el acuse de un AST que no tiene.
   */
  requiresCrewAcknowledgement: boolean("requires_crew_acknowledgement").notNull().default(true),
  measurementValidityMinutes: integer("measurement_validity_minutes"),
  measurementCalibrationValidityDays: integer("measurement_calibration_validity_days"),
  maxDurationHours:       integer("max_duration_hours").notNull().default(12),
  legalBasis:             text("legal_basis").notNull(),
  isActive:               boolean("is_active").notNull().default(true),
  createdByUserId:        text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:              timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:              timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_permit_type_active_idx").on(table.isActive),
  check("prevention_permit_type_duration_valid", sql`${table.maxDurationHours} > 0 AND ${table.maxDurationHours} <= 72`),
  check("prevention_permit_type_measurement_validity", sql`${table.requiresMeasurement} = false OR ${table.measurementValidityMinutes} > 0`),
  // Permisiva a propósito: `NULL` = este tipo de permiso no exige la regla de
  // vigencia de calibración (opt-in por tipo). Copiar la forma de
  // `requiresMeasurement` (`... OR columna > 0`) evaluaría a NULL, no a false,
  // sobre las filas ya existentes con la columna vacía, y Postgres rechaza un
  // CHECK que no se satisface al migrar.
  check("prevention_permit_type_calibration_validity", sql`${table.measurementCalibrationValidityDays} IS NULL OR ${table.measurementCalibrationValidityDays} > 0`),
  check("prevention_permit_type_basis_valid", sql`length(${table.legalBasis}) >= 5`),
])

/* ── Permiso de trabajo ───────────────────────────────────────────────────
 * `draft → pending_approval → approved → active → closed`, con rechazo,
 * suspensión y cancelación motivadas. Activar es el acto que habilita la
 * ejecución: exige controles verificados, aislamientos aplicados, mediciones
 * vigentes y una cuadrilla íntegramente habilitada.
 */
export const preventionWorkPermits = pgTable("prevention_work_permits", {
  id:                    text("id").primaryKey(),
  code:                  text("code").notNull().unique(),
  permitTypeId:          text("permit_type_id").notNull().references(() => preventionPermitTypes.id, { onDelete: "restrict" }),
  worksiteId:            text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  taskDescription:       text("task_description").notNull(),
  location:              text("location").notNull(),
  riskEntryId:           text("risk_entry_id").references(() => preventionRiskEntries.id, { onDelete: "set null" }),
  supervisorUserId:      text("supervisor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  plannedStartAt:        timestamp("planned_start_at", { withTimezone: true, mode: "string" }).notNull(),
  plannedEndAt:          timestamp("planned_end_at", { withTimezone: true, mode: "string" }).notNull(),
  status:                text("status").notNull().default("draft"),
  requestedByUserId:     text("requested_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  submittedAt:           timestamp("submitted_at", { withTimezone: true, mode: "string" }),
  approvedByUserId:      text("approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  approvedAt:            timestamp("approved_at", { withTimezone: true, mode: "string" }),
  rejectionReason:       text("rejection_reason"),
  activatedByUserId:     text("activated_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  activatedAt:           timestamp("activated_at", { withTimezone: true, mode: "string" }),
  suspendedByUserId:     text("suspended_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  suspendedAt:           timestamp("suspended_at", { withTimezone: true, mode: "string" }),
  suspensionReason:      text("suspension_reason"),
  extendedUntilAt:       timestamp("extended_until_at", { withTimezone: true, mode: "string" }),
  extensionReason:       text("extension_reason"),
  closedByUserId:        text("closed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  closedAt:              timestamp("closed_at", { withTimezone: true, mode: "string" }),
  closureSummary:        text("closure_summary"),
  cancelledByUserId:     text("cancelled_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  cancelledAt:           timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  cancellationReason:    text("cancellation_reason"),
  version:               integer("version").notNull().default(1),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_work_permit_worksite_idx").on(table.worksiteId, table.status),
  index("prevention_work_permit_window_idx").on(table.plannedStartAt, table.plannedEndAt),
  check("prevention_work_permit_status_valid", sql`${table.status} IN ('draft', 'pending_approval', 'approved', 'active', 'suspended', 'closed', 'rejected', 'cancelled')`),
  check("prevention_work_permit_window_valid", sql`${table.plannedEndAt} > ${table.plannedStartAt}`),
  check("prevention_work_permit_extension_valid", sql`${table.extendedUntilAt} IS NULL OR (${table.extendedUntilAt} > ${table.plannedEndAt} AND length(${table.extensionReason}) >= 10)`),
  check("prevention_work_permit_reject_consistent", sql`${table.status} <> 'rejected' OR length(${table.rejectionReason}) >= 10`),
  // Sin exigir `suspendedByUserId`: la suspensión automática por vencimiento de
  // ventana no tiene actor humano. El FK es `onDelete: "restrict"`, así que NULL
  // nunca puede significar "usuario borrado" — significa "sistema".
  check("prevention_work_permit_suspend_consistent", sql`(${table.suspendedAt} IS NULL AND ${table.suspendedByUserId} IS NULL) OR (${table.suspendedAt} IS NOT NULL AND length(${table.suspensionReason}) >= 10)`),
  check("prevention_work_permit_cancel_consistent", sql`(${table.cancelledAt} IS NULL AND ${table.cancelledByUserId} IS NULL) OR (${table.cancelledAt} IS NOT NULL AND ${table.cancelledByUserId} IS NOT NULL AND length(${table.cancellationReason}) >= 10)`),
  check("prevention_work_permit_close_consistent", sql`(${table.closedAt} IS NULL AND ${table.closedByUserId} IS NULL) OR (${table.closedAt} IS NOT NULL AND ${table.closedByUserId} IS NOT NULL AND length(${table.closureSummary}) >= 10)`),
  check("prevention_work_permit_version_positive", sql`${table.version} >= 1`),
])

/* ── Cuadrilla ────────────────────────────────────────────────────────────
 * Toda la cuadrilla es personal propio de Chome. La identidad de contratista
 * se retiró el 19-07-2026 junto con el módulo DS 76: Chome opera como empresa
 * contratista en faenas de terceros, no como empresa principal, así que nunca
 * acredita personal externo.
 */
export const preventionPermitCrew = pgTable("prevention_permit_crew", {
  id:                  text("id").primaryKey(),
  permitId:            text("permit_id").notNull().references(() => preventionWorkPermits.id, { onDelete: "cascade" }),
  workerId:            text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  role:                text("role").notNull(),
  acknowledgedAt:      timestamp("acknowledged_at", { withTimezone: true, mode: "string" }),
  acknowledgementSha256: text("acknowledgement_sha256"),
  /**
   * PER-002 (auditoría 2026-09-14): por dónde entró el acuse del AST. Antes
   * sólo cabía uno —sesión de la plataforma—, porque `acknowledgePermitCrew`
   * exigía que el integrante fuera usuario. La vía de enlace con token deja
   * acusar sin cuenta y esta columna la deja distinguible en la evidencia.
   */
  acknowledgementChannel: text("acknowledgement_channel"),
  acknowledgementIp:   text("acknowledgement_ip"),
  acknowledgementUserAgent: text("acknowledgement_user_agent"),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_permit_crew_worker_unique").on(table.permitId, table.workerId),
  check("prevention_permit_crew_ack_channel_valid", sql`(${table.acknowledgedAt} IS NULL AND ${table.acknowledgementChannel} IS NULL) OR (${table.acknowledgedAt} IS NOT NULL AND ${table.acknowledgementChannel} IN ('account', 'public_token'))`),
  index("prevention_permit_crew_permit_idx").on(table.permitId),
  check("prevention_permit_crew_role_valid", sql`${table.role} IN ('executor', 'supervisor', 'standby', 'observer')`),
  check("prevention_permit_crew_ack_consistent", sql`(${table.acknowledgedAt} IS NULL AND ${table.acknowledgementSha256} IS NULL) OR (${table.acknowledgedAt} IS NOT NULL AND length(${table.acknowledgementSha256}) = 64)`),
])

/* ── Controles verificados antes de habilitar ─────────────────────────────── */
export const preventionPermitControls = pgTable("prevention_permit_controls", {
  id:               text("id").primaryKey(),
  permitId:         text("permit_id").notNull().references(() => preventionWorkPermits.id, { onDelete: "cascade" }),
  description:      text("description").notNull(),
  isMandatory:      boolean("is_mandatory").notNull().default(true),
  verified:         boolean("verified").notNull().default(false),
  verifiedByUserId: text("verified_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  verifiedAt:       timestamp("verified_at", { withTimezone: true, mode: "string" }),
  notApplicableReason: text("not_applicable_reason"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_permit_control_permit_idx").on(table.permitId),
  check("prevention_permit_control_verified_consistent", sql`${table.verified} = false OR (${table.verifiedByUserId} IS NOT NULL AND ${table.verifiedAt} IS NOT NULL)`),
])

/* ── Aislamiento de energías (LOTO) ────────────────────────────────────────
 * Un aislamiento se aplica antes de habilitar y sólo se retira al cerrar. El
 * check impide registrar un retiro sin actor ni momento.
 */
export const preventionPermitIsolations = pgTable("prevention_permit_isolations", {
  id:                text("id").primaryKey(),
  permitId:          text("permit_id").notNull().references(() => preventionWorkPermits.id, { onDelete: "cascade" }),
  energySource:      text("energy_source").notNull(),
  equipmentTag:      text("equipment_tag").notNull(),
  isolationMethod:   text("isolation_method").notNull(),
  lockTagId:         text("lock_tag_id").notNull(),
  appliedByUserId:   text("applied_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  appliedAt:         timestamp("applied_at", { withTimezone: true, mode: "string" }),
  verifiedZeroEnergy: boolean("verified_zero_energy").notNull().default(false),
  removedByUserId:   text("removed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  removedAt:         timestamp("removed_at", { withTimezone: true, mode: "string" }),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_permit_isolation_permit_idx").on(table.permitId),
  check("prevention_permit_isolation_energy_valid", sql`${table.energySource} IN ('electrical', 'mechanical', 'hydraulic', 'pneumatic', 'thermal', 'chemical', 'gravitational', 'other')`),
  check("prevention_permit_isolation_applied_consistent", sql`(${table.appliedAt} IS NULL AND ${table.appliedByUserId} IS NULL) OR (${table.appliedAt} IS NOT NULL AND ${table.appliedByUserId} IS NOT NULL)`),
  check("prevention_permit_isolation_removed_consistent", sql`(${table.removedAt} IS NULL AND ${table.removedByUserId} IS NULL) OR (${table.removedAt} IS NOT NULL AND ${table.removedByUserId} IS NOT NULL AND ${table.appliedAt} IS NOT NULL)`),
])

/* ── Mediciones (atmósfera en espacio confinado, etc.) ─────────────────────── */
export const preventionPermitMeasurements = pgTable("prevention_permit_measurements", {
  id:              text("id").primaryKey(),
  permitId:        text("permit_id").notNull().references(() => preventionWorkPermits.id, { onDelete: "cascade" }),
  parameter:       text("parameter").notNull(),
  value:           numeric("value", { precision: 12, scale: 4 }).notNull(),
  unit:            text("unit").notNull(),
  acceptableMin:   numeric("acceptable_min", { precision: 12, scale: 4 }),
  acceptableMax:   numeric("acceptable_max", { precision: 12, scale: 4 }),
  withinRange:     boolean("within_range").notNull(),
  equipmentTag:    text("equipment_tag").notNull(),
  calibrationDate: text("calibration_date"),
  takenByUserId:   text("taken_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  takenAt:         timestamp("taken_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_permit_measurement_permit_idx").on(table.permitId, table.takenAt),
])

/* ── AST / JSA ────────────────────────────────────────────────────────────── */
export const preventionJsaSteps = pgTable("prevention_jsa_steps", {
  id:           text("id").primaryKey(),
  permitId:     text("permit_id").notNull().references(() => preventionWorkPermits.id, { onDelete: "cascade" }),
  stepOrder:    integer("step_order").notNull(),
  stepDescription: text("step_description").notNull(),
  hazards:      jsonb("hazards").notNull(),
  controls:     jsonb("controls").notNull(),
  residualRisk: text("residual_risk").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_jsa_step_order_unique").on(table.permitId, table.stepOrder),
  check("prevention_jsa_step_order_positive", sql`${table.stepOrder} >= 1`),
  check("prevention_jsa_residual_valid", sql`${table.residualRisk} IN ('low', 'medium', 'high', 'critical')`),
])

/* ── Historial inmutable ──────────────────────────────────────────────────── */
export const preventionPermitHistory = pgTable("prevention_permit_history", {
  id:          text("id").primaryKey(),
  permitId:    text("permit_id").notNull().references(() => preventionWorkPermits.id, { onDelete: "cascade" }),
  changeType:  text("change_type").notNull(),
  fromStatus:  text("from_status"),
  toStatus:    text("to_status"),
  reason:      text("reason").notNull(),
  beforeState: jsonb("before_state"),
  afterState:  jsonb("after_state"),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_permit_history_permit_idx").on(table.permitId, table.createdAt),
])

/* ── Relations ────────────────────────────────────────────────────────────── */
export const preventionWorkPermitsRelations = relations(preventionWorkPermits, ({ one, many }) => ({
  permitType: one(preventionPermitTypes, { fields: [preventionWorkPermits.permitTypeId], references: [preventionPermitTypes.id] }),
  worksite: one(worksites, { fields: [preventionWorkPermits.worksiteId], references: [worksites.id] }),
  supervisor: one(users, { fields: [preventionWorkPermits.supervisorUserId], references: [users.id], relationName: "permitSupervisor" }),
  crew: many(preventionPermitCrew),
  controls: many(preventionPermitControls),
  isolations: many(preventionPermitIsolations),
  measurements: many(preventionPermitMeasurements),
  jsaSteps: many(preventionJsaSteps),
}))

export const preventionPermitCrewRelations = relations(preventionPermitCrew, ({ one }) => ({
  permit: one(preventionWorkPermits, { fields: [preventionPermitCrew.permitId], references: [preventionWorkPermits.id] }),
  worker: one(workers, { fields: [preventionPermitCrew.workerId], references: [workers.id] }),
}))

export const preventionPermitControlsRelations = relations(preventionPermitControls, ({ one }) => ({
  permit: one(preventionWorkPermits, { fields: [preventionPermitControls.permitId], references: [preventionWorkPermits.id] }),
}))

export const preventionPermitIsolationsRelations = relations(preventionPermitIsolations, ({ one }) => ({
  permit: one(preventionWorkPermits, { fields: [preventionPermitIsolations.permitId], references: [preventionWorkPermits.id] }),
}))

export const preventionPermitMeasurementsRelations = relations(preventionPermitMeasurements, ({ one }) => ({
  permit: one(preventionWorkPermits, { fields: [preventionPermitMeasurements.permitId], references: [preventionWorkPermits.id] }),
}))

export const preventionJsaStepsRelations = relations(preventionJsaSteps, ({ one }) => ({
  permit: one(preventionWorkPermits, { fields: [preventionJsaSteps.permitId], references: [preventionWorkPermits.id] }),
}))

export type PreventionPermitType = typeof preventionPermitTypes.$inferSelect
export type PreventionWorkPermit = typeof preventionWorkPermits.$inferSelect
export type PreventionPermitCrew = typeof preventionPermitCrew.$inferSelect
export type PreventionPermitControl = typeof preventionPermitControls.$inferSelect
export type PreventionPermitIsolation = typeof preventionPermitIsolations.$inferSelect
export type PreventionPermitMeasurement = typeof preventionPermitMeasurements.$inferSelect
export type PreventionJsaStep = typeof preventionJsaSteps.$inferSelect

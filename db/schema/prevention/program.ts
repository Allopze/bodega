import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"
import { preventionEvidenceUploads } from "./evidence-uploads"
import { preventionRiskControls, preventionRiskMatrices, preventionRiskProcesses } from "./risk-legal"

/* ── Programa de Trabajo Preventivo RE-04.1 (F2) ────────────────────────────
 * El programa deja de ser una planilla aparte: cuelga 1:1 del MIPER y se
 * reemplaza con el período, del mismo modo que la matriz. No evalúa riesgo
 * (los P y C, las bandas y la clasificación no se tocan): ejecuta las medidas
 * de control que el MIPER ya definió.
 *
 * Los nombres de las FKs van explícitos porque el nombre que genera Drizzle
 * (`<tabla>_<columna>_<tabla_destino>_<columna_destino>_fk`) supera los 63
 * bytes que Postgres conserva y quedaría truncado e irreconocible para un
 * `DROP CONSTRAINT` futuro (el mismo problema de la 0176). El guardián
 * `scripts/verify-migration-chain.mjs` congela el baseline de nombres largos:
 * estos son nuevos y deben caber. */

export const preventionRiskPrograms = pgTable("prevention_risk_programs", {
  id: text("id").primaryKey(),
  /* Un MIPER tiene a lo más un programa (índice único más abajo). `cascade`
   * porque el programa no sobrevive al documento que ejecuta. */
  matrixId: text("matrix_id").notNull(),
  worksiteId: text("worksite_id").notNull(),
  period: integer("period").notNull(),
  // ── Encabezado RE-04.1 (§7.1): mismos campos de empresa que la matriz. ──
  companyName: text("company_name"),
  companyRut: text("company_rut"),
  companyAddress: text("company_address"),
  companyCommune: text("company_commune"),
  economicActivity: text("economic_activity"),
  adherentNumber: text("adherent_number"),
  worksiteName: text("worksite_name"),
  /* Representante de la empresa en la faena (Administrador de contrato), mismo
   * criterio que §4.8. Nunca el representante legal corporativo. */
  siteRepresentativeUserId: text("site_representative_user_id"),
  siteRepresentativeName: text("site_representative_name"),
  headcountTotal: integer("headcount_total"),
  headcountMale: integer("headcount_male"),
  headcountFemale: integer("headcount_female"),
  headcountOther: integer("headcount_other"),
  /** Encargado del programa (columna «Encargado» del RE-04.1). */
  programManagerUserId: text("program_manager_user_id"),
  elaboratedOn: text("elaborated_on"),
  // «Fecha última revisión» no se guarda: se deriva de la última versión sellada.
  version: integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_programs_matrix_unique").on(table.matrixId),
  foreignKey({ columns: [table.matrixId], foreignColumns: [preventionRiskMatrices.id], name: "prevention_program_matrix_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.worksiteId], foreignColumns: [worksites.id], name: "prevention_program_worksite_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.siteRepresentativeUserId], foreignColumns: [users.id], name: "prevention_program_site_representative_fk" }),
  foreignKey({ columns: [table.programManagerUserId], foreignColumns: [users.id], name: "prevention_program_manager_fk" }),
  foreignKey({ columns: [table.createdByUserId], foreignColumns: [users.id], name: "prevention_program_created_by_fk" }),
  check("prevention_risk_programs_period_valid", sql`${table.period} BETWEEN 2000 AND 2100`),
  check("prevention_risk_programs_version_positive", sql`${table.version} > 0`),
])

export const preventionRiskProgramActions = pgTable("prevention_risk_program_actions", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull(),
  /** N° visible del RE-04.1. Correlativo por programa, no identidad global. */
  actionNumber: integer("action_number").notNull(),
  /* La columna «Proceso» es la actividad del diccionario del MIPER, no texto
   * libre: nullable porque una actividad puede crearse desde una medida sin
   * proceso asignado todavía. `restrict` para no perder el referente. */
  processId: text("process_id"),
  description: text("description").notNull(),
  responsibleUserId: text("responsible_user_id"),
  /* El nombre y cargo quedan congelados: si la persona cambia de rol, el
   * programa impreso sigue diciendo quién era el responsable cuando se acordó. */
  responsibleSnapshot: text("responsible_snapshot"),
  locationLabel: text("location_label"),
  scheduleKind: text("schedule_kind").notNull(),
  startsOn: text("starts_on").notNull(),
  status: text("status").notNull().default("active"),
  retiredAt: timestamp("retired_at", { withTimezone: true, mode: "string" }),
  retiredReason: text("retired_reason"),
  version: integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_program_actions_program_action_unique").on(table.programId, table.actionNumber),
  foreignKey({ columns: [table.programId], foreignColumns: [preventionRiskPrograms.id], name: "prevention_program_action_program_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.processId], foreignColumns: [preventionRiskProcesses.id], name: "prevention_program_action_process_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.responsibleUserId], foreignColumns: [users.id], name: "prevention_program_action_responsible_fk" }),
  foreignKey({ columns: [table.createdByUserId], foreignColumns: [users.id], name: "prevention_program_action_created_by_fk" }),
  check("prevention_risk_program_actions_number_positive", sql`${table.actionNumber} >= 1`),
  check("prevention_risk_program_actions_version_positive", sql`${table.version} > 0`),
  check("prevention_risk_program_actions_schedule_valid", sql`${table.scheduleKind} IN ('once', 'monthly', 'quarterly', 'semiannual', 'annual')`),
  check("prevention_risk_program_actions_status_valid", sql`${table.status} IN ('active', 'retired')`),
  /* `coalesce` no es decorativo: sin él `length(trim(NULL))` es NULL,
   * `NULL >= 10` es NULL y el CHECK se satisface (un CHECK sólo rechaza
   * FALSE) — una actividad podía quedar `retired` sin motivo. */
  check("prevention_risk_program_actions_retired_complete", sql`${table.status} <> 'retired' OR (${table.retiredAt} IS NOT NULL AND length(trim(coalesce(${table.retiredReason}, ''))) >= 10)`),
])

/* N:M actividad ↔ medida. El sistema propone agrupaciones y la persona decide
 * qué medida cubre qué actividad (§7.3); el vínculo es lo que hace trazable
 * "esta actividad se creó por estos riesgos". */
export const preventionRiskProgramActionControls = pgTable("prevention_risk_program_action_controls", {
  id: text("id").primaryKey(),
  actionId: text("action_id").notNull(),
  controlId: text("control_id").notNull(),
  linkedByUserId: text("linked_by_user_id").notNull(),
  linkedAt: timestamp("linked_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_program_action_controls_pair_unique").on(table.actionId, table.controlId),
  foreignKey({ columns: [table.actionId], foreignColumns: [preventionRiskProgramActions.id], name: "prevention_program_action_control_action_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.controlId], foreignColumns: [preventionRiskControls.id], name: "prevention_program_action_control_control_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.linkedByUserId], foreignColumns: [users.id], name: "prevention_program_action_control_linked_by_fk" }),
])

/* Ocurrencia planificada de una actividad (§7.4). `outcome` es un resumen
 * mantenido por el servicio —siempre el del último registro no anulado, o
 * `pending`—; `superseded` marca las pendientes de un programa reemplazado. */
export const preventionRiskProgramOccurrences = pgTable("prevention_risk_program_occurrences", {
  id: text("id").primaryKey(),
  actionId: text("action_id").notNull(),
  dueOn: text("due_on").notNull(),
  outcome: text("outcome").notNull().default("pending"),
  /* Último registro vigente. Se declara con la forma perezosa de Drizzle
   * (`.references(() => …)`) porque los registros se declaran después y la
   * referencia es circular: cada tabla apunta a la otra. */
  currentRecordId: text("current_record_id").references((): AnyPgColumn => preventionRiskProgramOccurrenceRecords.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_program_occurrences_action_due_unique").on(table.actionId, table.dueOn),
  foreignKey({ columns: [table.actionId], foreignColumns: [preventionRiskProgramActions.id], name: "prevention_program_occurrence_action_fk" }).onDelete("cascade"),
  check("prevention_risk_program_occurrences_outcome_valid", sql`${table.outcome} IN ('pending', 'done', 'not_done', 'superseded')`),
])

/* Registro de ejecución «Se hizo / No se hizo». Sólo inserción (trigger en la
 * 0346): corregir es anular con motivo y volver a registrar, nunca editar ni
 * borrar. Así un «No se hizo» seguido de un «Se hizo (fuera de plazo)» son dos
 * registros visibles y una anulación no pierde historia. */
export const preventionRiskProgramOccurrenceRecords = pgTable("prevention_risk_program_occurrence_records", {
  id: text("id").primaryKey(),
  occurrenceId: text("occurrence_id").notNull(),
  outcome: text("outcome").notNull(),
  /** Fecha efectiva. Obligatoria para «Se hizo». */
  effectiveOn: text("effective_on"),
  late: boolean("late").notNull().default(false),
  reason: text("reason"),
  notes: text("notes"),
  recordedByUserId: text("recorded_by_user_id").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedByUserId: text("voided_by_user_id"),
  voidReason: text("void_reason"),
}, (table) => [
  foreignKey({ columns: [table.occurrenceId], foreignColumns: [preventionRiskProgramOccurrences.id], name: "prevention_program_record_occurrence_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.recordedByUserId], foreignColumns: [users.id], name: "prevention_program_record_recorded_by_fk" }),
  foreignKey({ columns: [table.voidedByUserId], foreignColumns: [users.id], name: "prevention_program_record_voided_by_fk" }),
  check("prevention_risk_program_occurrence_records_outcome_valid", sql`${table.outcome} IN ('done', 'not_done')`),
  check("prevention_risk_program_occurrence_records_done_effective", sql`${table.outcome} <> 'done' OR ${table.effectiveOn} IS NOT NULL`),
  check("prevention_risk_program_occurrence_records_not_done_reason", sql`${table.outcome} <> 'not_done' OR length(trim(coalesce(${table.reason}, ''))) >= 10`),
  // Anular exige motivo y autor; el trigger impide cualquier otro cambio.
  check("prevention_risk_program_occurrence_records_void_complete", sql`${table.voidedAt} IS NULL OR (${table.voidedByUserId} IS NOT NULL AND length(trim(coalesce(${table.voidReason}, ''))) >= 10)`),
])

/* Evidencia de un registro (§7.6): el archivo vive en `prevention_evidence_uploads`
 * (dominio `miper`) y esta fila lo acredita. `restrict` para no borrar el archivo
 * del que alguien depende como prueba; retirar exige motivo y no borra nada. */
export const preventionRiskOccurrenceEvidence = pgTable("prevention_risk_occurrence_evidence", {
  id: text("id").primaryKey(),
  recordId: text("record_id").notNull(),
  evidenceUploadId: text("evidence_upload_id").notNull(),
  description: text("description"),
  uploadedByUserId: text("uploaded_by_user_id"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true, mode: "string" }),
  withdrawnByUserId: text("withdrawn_by_user_id"),
  withdrawReason: text("withdraw_reason"),
}, (table) => [
  foreignKey({ columns: [table.recordId], foreignColumns: [preventionRiskProgramOccurrenceRecords.id], name: "prevention_occurrence_evidence_record_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.evidenceUploadId], foreignColumns: [preventionEvidenceUploads.path], name: "prevention_occurrence_evidence_upload_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.uploadedByUserId], foreignColumns: [users.id], name: "prevention_occurrence_evidence_uploaded_by_fk" }),
  foreignKey({ columns: [table.withdrawnByUserId], foreignColumns: [users.id], name: "prevention_occurrence_evidence_withdrawn_by_fk" }),
  check("prevention_risk_occurrence_evidence_withdraw_complete", sql`${table.withdrawnAt} IS NULL OR (${table.withdrawnByUserId} IS NOT NULL AND length(trim(coalesce(${table.withdrawReason}, ''))) >= 10)`),
])

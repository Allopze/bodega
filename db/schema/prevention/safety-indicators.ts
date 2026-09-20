import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"

/**
 * Indicadores de accidentabilidad SST — una fila por (faena, año, mes).
 * Tasa de frecuencia, tasa de gravedad y total de accidentes NO se
 * almacenan: son derivadas y se calculan al leer (lib/services), para
 * no arrastrar una denormalización que se pueda desincronizar.
 */
export const safetyIndicators = pgTable("safety_indicators", {
  id:                  text("id").primaryKey(),
  worksiteId:          text("worksite_id").notNull().references(() => worksites.id),
  year:                integer("year").notNull(),
  month:               integer("month").notNull(),
  trabajadores:        integer("trabajadores").notNull().default(0),
  horasHombre:         numeric("horas_hombre", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  accConTiempoPerdido: integer("acc_con_tiempo_perdido").notNull().default(0),
  accSinTiempoPerdido: integer("acc_sin_tiempo_perdido").notNull().default(0),
  diasPerdidos:        integer("dias_perdidos").notNull().default(0),
  incidentes:          integer("incidentes").notNull().default(0),
  danoMaterial:        integer("dano_material").notNull().default(0),
  danoAmbiental:       integer("dano_ambiental").notNull().default(0),
  provenanceStatus:    text("provenance_status").notNull().default("manual_legacy"),
  reconciledSnapshotId: text("reconciled_snapshot_id"),
  reconciledByUserId:  text("reconciled_by_user_id").references(() => users.id),
  reconciledAt:        timestamp("reconciled_at", { withTimezone: true, mode: "string" }),
  updatedByUserId:     text("updated_by_user_id").references(() => users.id),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("safety_indicators_worksite_period_unique").on(table.worksiteId, table.year, table.month),
  index("safety_indicators_worksite_year_idx").on(table.worksiteId, table.year),
  check("safety_indicators_month_check", sql`${table.month} BETWEEN 1 AND 12`),
  check("safety_indicators_year_check", sql`${table.year} BETWEEN 2024 AND 2100`),
  check("safety_indicators_trabajadores_check", sql`${table.trabajadores} >= 0`),
  check("safety_indicators_horas_hombre_check", sql`${table.horasHombre} >= 0`),
  check("safety_indicators_acc_ctp_check", sql`${table.accConTiempoPerdido} >= 0`),
  check("safety_indicators_acc_stp_check", sql`${table.accSinTiempoPerdido} >= 0`),
  check("safety_indicators_dias_perdidos_check", sql`${table.diasPerdidos} >= 0`),
  check("safety_indicators_incidentes_check", sql`${table.incidentes} >= 0`),
  check("safety_indicators_dano_material_check", sql`${table.danoMaterial} >= 0`),
  check("safety_indicators_dano_ambiental_check", sql`${table.danoAmbiental} >= 0`),
  check("safety_indicators_provenance_check", sql`${table.provenanceStatus} IN ('manual_legacy', 'difference', 'reconciled')`),
])

/** Denominadores mensuales controlados; reemplazan las cifras manuales del snapshot legado. */
export const safetyIndicatorDenominators = pgTable("safety_indicator_denominators", {
  id:                    text("id").primaryKey(),
  worksiteId:            text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  year:                  integer("year").notNull(),
  month:                 integer("month").notNull(),
  workerCount:           integer("worker_count").notNull(),
  workedHours:           numeric("worked_hours", { precision: 14, scale: 2, mode: "number" }).notNull(),
  sourceType:            text("source_type").notNull(),
  sourceReference:       text("source_reference").notNull(),
  evidenceReference:     text("evidence_reference"),
  evidenceChecksumSha256: text("evidence_checksum_sha256"),
  status:                text("status").notNull().default("draft"),
  reconciliationStatus:  text("reconciliation_status").notNull().default("pending"),
  reconciliationNotes:   text("reconciliation_notes"),
  version:               integer("version").notNull().default(1),
  createdByUserId:       text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  updatedByUserId:       text("updated_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  approvedByUserId:      text("approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  approvedAt:            timestamp("approved_at", { withTimezone: true, mode: "string" }),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("safety_indicator_denominator_period_unique").on(table.worksiteId, table.year, table.month),
  index("safety_indicator_denominator_status_idx").on(table.status, table.reconciliationStatus),
  check("safety_indicator_denominator_month_check", sql`${table.month} BETWEEN 1 AND 12`),
  check("safety_indicator_denominator_year_check", sql`${table.year} BETWEEN 2024 AND 2100`),
  check("safety_indicator_denominator_values_check", sql`${table.workerCount} >= 0 AND ${table.workedHours} >= 0`),
  check("safety_indicator_denominator_source_check", sql`${table.sourceType} IN ('rrhh', 'xlsx_import', 'manual', 'other_system')`),
  check("safety_indicator_denominator_status_check", sql`${table.status} IN ('draft', 'pending_review', 'approved', 'rejected')`),
  check("safety_indicator_denominator_reconciliation_check", sql`${table.reconciliationStatus} IN ('pending', 'matched', 'difference', 'exception')`),
  check("safety_indicator_denominator_version_check", sql`${table.version} >= 1`),
  check("safety_indicator_denominator_checksum_check", sql`${table.evidenceChecksumSha256} IS NULL OR length(${table.evidenceChecksumSha256}) = 64`),
  check("safety_indicator_denominator_approval_evidence_check", sql`${table.status} <> 'approved' OR (${table.approvedByUserId} IS NOT NULL AND ${table.approvedAt} IS NOT NULL AND ${table.evidenceReference} IS NOT NULL AND ${table.reconciliationStatus} <> 'pending')`),
])

export interface SafetyIndicatorSnapshotInputs {
  incidentIds: string[]
  personCaseKeys: string[]
  denominatorIds: string[]
  denominatorVersions: number[]
}

export interface SafetyIndicatorSnapshotResults {
  status: string
  accidents: number
  injuredPeople: number
  absenceDays: number
  chargeDays: number
  workerAverage: number | null
  workedHours: number
  accidentabilityRate: number | null
  frequencyRate: number | null
  severityRate: number | null
}

/** Snapshot inmutable de un cálculo cerrado/aprobado, con fórmula y hash de fuentes. */
export const safetyIndicatorSnapshots = pgTable("safety_indicator_snapshots", {
  id:                   text("id").primaryKey(),
  worksiteId:           text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  periodType:           text("period_type").notNull(),
  year:                 integer("year").notNull(),
  startMonth:           integer("start_month").notNull(),
  endMonth:             integer("end_month").notNull(),
  formulaVersion:       text("formula_version").notNull(),
  sourceHashSha256:     text("source_hash_sha256").notNull(),
  inputSnapshot:        jsonb("input_snapshot").$type<SafetyIndicatorSnapshotInputs>().notNull(),
  resultSnapshot:       jsonb("result_snapshot").$type<SafetyIndicatorSnapshotResults>().notNull(),
  status:               text("status").notNull(),
  hasPendingCases:      boolean("has_pending_cases").notNull().default(false),
  reconciliationStatus: text("reconciliation_status").notNull(),
  legacyComparison:     jsonb("legacy_comparison").$type<Record<string, unknown>>(),
  supersededById:       text("superseded_by_id"),
  version:              integer("version").notNull().default(1),
  createdByUserId:      text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  approvedByUserId:     text("approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  approvalReason:       text("approval_reason"),
  createdAt:            timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  approvedAt:           timestamp("approved_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  uniqueIndex("safety_indicator_snapshot_source_unique").on(table.worksiteId, table.periodType, table.year, table.startMonth, table.endMonth, table.sourceHashSha256),
  index("safety_indicator_snapshot_period_idx").on(table.worksiteId, table.year, table.startMonth, table.endMonth, table.status),
  check("safety_indicator_snapshot_period_type_check", sql`${table.periodType} IN ('monthly', 'semester', 'annual')`),
  check("safety_indicator_snapshot_months_check", sql`${table.startMonth} BETWEEN 1 AND 12 AND ${table.endMonth} BETWEEN ${table.startMonth} AND 12`),
  check("safety_indicator_snapshot_status_check", sql`${table.status} IN ('provisional', 'approved', 'superseded')`),
  check("safety_indicator_snapshot_reconciliation_check", sql`${table.reconciliationStatus} IN ('pending', 'matched', 'difference', 'exception')`),
  check("safety_indicator_snapshot_hash_check", sql`length(${table.sourceHashSha256}) = 64`),
  check("safety_indicator_snapshot_version_check", sql`${table.version} >= 1`),
  check("safety_indicator_snapshot_approval_check", sql`${table.status} <> 'approved' OR (${table.approvedByUserId} IS NOT NULL AND ${table.approvedAt} IS NOT NULL AND ${table.approvalReason} IS NOT NULL AND ${table.hasPendingCases} = false AND ${table.reconciliationStatus} = 'matched')`),
])


/** Cierre administrativo de un mes; el registro del indicador no se duplica. */
export const safetyIndicatorPeriods = pgTable("safety_indicator_periods", {
  id:           text("id").primaryKey(),
  worksiteId:   text("worksite_id").notNull().references(() => worksites.id),
  year:         integer("year").notNull(),
  month:        integer("month").notNull(),
  closedByUserId: text("closed_by_user_id").notNull().references(() => users.id),
  closedAt:     timestamp("closed_at", { withTimezone: true, mode: "string" }).notNull(),
  status:       text("status").notNull().default("closed"),
  snapshotId:   text("snapshot_id"),
  closeReason:  text("close_reason"),
  reopenedByUserId: text("reopened_by_user_id").references(() => users.id),
  reopenedAt:   timestamp("reopened_at", { withTimezone: true, mode: "string" }),
  reopenReason: text("reopen_reason"),
  version:      integer("version").notNull().default(1),
}, (table) => [
  uniqueIndex("safety_indicator_periods_worksite_period_unique").on(table.worksiteId, table.year, table.month),
  check("safety_indicator_periods_month_check", sql`${table.month} BETWEEN 1 AND 12`),
  check("safety_indicator_periods_year_check", sql`${table.year} BETWEEN 2024 AND 2100`),
  check("safety_indicator_periods_status_check", sql`${table.status} IN ('closed', 'reopened')`),
  check("safety_indicator_periods_version_check", sql`${table.version} >= 1`),
  check("safety_indicator_periods_reopen_check", sql`${table.status} <> 'reopened' OR (${table.reopenedByUserId} IS NOT NULL AND ${table.reopenedAt} IS NOT NULL AND ${table.reopenReason} IS NOT NULL)`),
])

export const safetyIndicatorsRelations = relations(safetyIndicators, ({ one }) => ({
  worksite:        one(worksites, { fields: [safetyIndicators.worksiteId], references: [worksites.id] }),
  updatedByUser:   one(users, { fields: [safetyIndicators.updatedByUserId], references: [users.id] }),
}))

export const safetyIndicatorDenominatorsRelations = relations(safetyIndicatorDenominators, ({ one }) => ({
  worksite: one(worksites, { fields: [safetyIndicatorDenominators.worksiteId], references: [worksites.id] }),
  createdBy: one(users, { fields: [safetyIndicatorDenominators.createdByUserId], references: [users.id], relationName: "safetyIndicatorDenominatorCreator" }),
  updatedBy: one(users, { fields: [safetyIndicatorDenominators.updatedByUserId], references: [users.id], relationName: "safetyIndicatorDenominatorUpdater" }),
  approvedBy: one(users, { fields: [safetyIndicatorDenominators.approvedByUserId], references: [users.id], relationName: "safetyIndicatorDenominatorApprover" }),
}))

export const safetyIndicatorSnapshotsRelations = relations(safetyIndicatorSnapshots, ({ one }) => ({
  worksite: one(worksites, { fields: [safetyIndicatorSnapshots.worksiteId], references: [worksites.id] }),
  createdBy: one(users, { fields: [safetyIndicatorSnapshots.createdByUserId], references: [users.id], relationName: "safetyIndicatorSnapshotCreator" }),
  approvedBy: one(users, { fields: [safetyIndicatorSnapshots.approvedByUserId], references: [users.id], relationName: "safetyIndicatorSnapshotApprover" }),
}))


export const safetyIndicatorPeriodsRelations = relations(safetyIndicatorPeriods, ({ one }) => ({
  worksite: one(worksites, { fields: [safetyIndicatorPeriods.worksiteId], references: [worksites.id] }),
  closedByUser: one(users, { fields: [safetyIndicatorPeriods.closedByUserId], references: [users.id] }),
}))

export type SafetyIndicator = typeof safetyIndicators.$inferSelect
export type NewSafetyIndicator = typeof safetyIndicators.$inferInsert
export type SafetyIndicatorPeriod = typeof safetyIndicatorPeriods.$inferSelect
export type SafetyIndicatorDenominator = typeof safetyIndicatorDenominators.$inferSelect
export type SafetyIndicatorSnapshot = typeof safetyIndicatorSnapshots.$inferSelect

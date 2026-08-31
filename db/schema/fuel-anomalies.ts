import { relations, sql } from "drizzle-orm"
import { pgTable, text, integer, timestamp, boolean, check, index, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"
import { fuelVehicles } from "./fuel-vehicles"

/* ── Fuel Anomaly Rules (reglas de detección configurables, sección 11) ───── */

export const fuelAnomalyRules = pgTable("fuel_anomaly_rules", {
  id:             text("id").primaryKey(),
  code:           text("code").notNull().unique(),           // "rendimiento_fuera_historico"
  name:           text("name").notNull(),
  description:    text("description"),
  severity:       text("severity").notNull().default("medium"), // low | medium | high | critical
  isActive:       boolean("is_active").notNull().default(true),
  /** JSON con parámetros específicos de la regla (umbral, ventana, etc.). */
  config:         text("config").$default(() => "{}"),
  createdBy:      text("created_by").references(() => users.id),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_anomaly_rules_severity_valid", sql`${table.severity} IN ('low', 'medium', 'high', 'critical')`),
  index("fuel_anomaly_rules_code_idx").on(table.code),
  index("fuel_anomaly_rules_active_idx").on(table.isActive),
])

/* ── Fuel Anomaly Cases (casos detectados, sección 11) ──────────────────── */

export const fuelAnomalyCases = pgTable("fuel_anomaly_cases", {
  id:                text("id").primaryKey(),
  ruleId:            text("rule_id").notNull().references(() => fuelAnomalyRules.id),
  ruleCode:          text("rule_code").notNull(),
  severity:          text("severity").notNull().default("medium"),
  worksiteId:        text("worksite_id").references(() => worksites.id),
  vehicleId:         text("vehicle_id").references(() => fuelVehicles.id),
  /** Nulo cuando la anomalía no está vinculada a un registro fuente específico. */
  referenceEntityType: text("reference_entity_type"),
  /** ID del registro fuente (fuel_consumption_records, fuel_tae_submissions, etc.). */
  referenceEntityId:   text("reference_entity_id"),
  description:       text("description").notNull(),
  observedValue:     text("observed_value"),
  expectedValue:     text("expected_value"),
  status:            text("status").notNull().default("open"),
  assigneeId:        text("assignee_id").references(() => users.id),
  resolution:        text("resolution"),
  /**
   * Sólo para las reglas de medidor regresivo: distingue "el número estaba mal
   * anotado" de "el medidor físico cambió". Flota y Mantenciones tratan como
   * reinicio de serie SÓLO `reset_medidor`; sin esta columna, corregir un error
   * de tipeo cortaba la serie del equipo para siempre.
   */
  resolutionKind:    text("resolution_kind"),
  resolvedById:      text("resolved_by_id").references(() => users.id),
  resolvedAt:        timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  detectedAt:        timestamp("detected_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_anomaly_cases_severity_valid", sql`${table.severity} IN ('low', 'medium', 'high', 'critical')`),
  check("fuel_anomaly_cases_status_valid", sql`${table.status} IN ('open', 'in_review', 'resolved', 'dismissed', 'reopened')`),
  check("fuel_anomaly_cases_resolution_kind_valid", sql`${table.resolutionKind} IS NULL OR ${table.resolutionKind} IN ('lectura_corregida', 'reset_medidor')`),
  index("fuel_anomaly_cases_rule_idx").on(table.ruleId),
  index("fuel_anomaly_cases_status_idx").on(table.status),
  index("fuel_anomaly_cases_worksite_idx").on(table.worksiteId),
  index("fuel_anomaly_cases_reference_idx").on(table.referenceEntityType, table.referenceEntityId),
  uniqueIndex("fuel_anomaly_cases_unique_open").on(table.ruleCode, table.referenceEntityType, table.referenceEntityId)
    .where(sql`${table.status} IN ('open', 'in_review', 'reopened')`),
])

/* ── Fuel Anomaly Executions (registro de corridas de detección, sección 11) ─ */

export const fuelAnomalyExecutions = pgTable("fuel_anomaly_executions", {
  id:             text("id").primaryKey(),
  ruleId:         text("rule_id").notNull().references(() => fuelAnomalyRules.id),
  startedAt:      timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  completedAt:    timestamp("completed_at", { withTimezone: true, mode: "string" }),
  casesCreated:   integer("cases_created").notNull().default(0),
  casesSkipped:   integer("cases_skipped").notNull().default(0),
  totalScanned:   integer("total_scanned").notNull().default(0),
  status:         text("status").notNull().default("running"),
  error:          text("error"),
}, (table) => [
  check("fuel_anomaly_executions_status_valid", sql`${table.status} IN ('running', 'completed', 'failed')`),
  index("fuel_anomaly_executions_rule_idx").on(table.ruleId),
  index("fuel_anomaly_executions_status_idx").on(table.status),
])

export const fuelAnomalyExecutionsRelations = relations(fuelAnomalyExecutions, ({ one }) => ({
  rule: one(fuelAnomalyRules, { fields: [fuelAnomalyExecutions.ruleId], references: [fuelAnomalyRules.id] }),
}))

/* ── Fuel Anomaly Comments (hilo de discusión por caso, sección 11) ──────── */

export const fuelAnomalyComments = pgTable("fuel_anomaly_comments", {
  id:          text("id").primaryKey(),
  caseId:      text("case_id").notNull().references(() => fuelAnomalyCases.id, { onDelete: "cascade" }),
  userId:      text("user_id").notNull().references(() => users.id),
  body:        text("body").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("fuel_anomaly_comments_case_idx").on(table.caseId),
])

/* ── Relations ──────────────────────────────────────────────────────────── */

export const fuelAnomalyRulesRelations = relations(fuelAnomalyRules, ({ one, many }) => ({
  creator: one(users, { fields: [fuelAnomalyRules.createdBy], references: [users.id] }),
  cases: many(fuelAnomalyCases),
}))

export const fuelAnomalyCasesRelations = relations(fuelAnomalyCases, ({ one, many }) => ({
  rule: one(fuelAnomalyRules, { fields: [fuelAnomalyCases.ruleId], references: [fuelAnomalyRules.id] }),
  worksite: one(worksites, { fields: [fuelAnomalyCases.worksiteId], references: [worksites.id] }),
  vehicle: one(fuelVehicles, { fields: [fuelAnomalyCases.vehicleId], references: [fuelVehicles.id] }),
  assignee: one(users, { fields: [fuelAnomalyCases.assigneeId], references: [users.id] }),
  resolvedBy: one(users, { fields: [fuelAnomalyCases.resolvedById], references: [users.id] }),
  comments: many(fuelAnomalyComments),
}))

export const fuelAnomalyCommentsRelations = relations(fuelAnomalyComments, ({ one }) => ({
  case: one(fuelAnomalyCases, { fields: [fuelAnomalyComments.caseId], references: [fuelAnomalyCases.id] }),
  user: one(users, { fields: [fuelAnomalyComments.userId], references: [users.id] }),
}))

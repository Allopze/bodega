import { sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { preventionRiskEntries, preventionRiskMatrices } from "./risk-legal"

/* Cada envío a revisión congela una foto (lib/prevention/miper/snapshot.ts).
 * La revisora y Legal y RRHH revisan esa foto, no los datos vivos. */
export const preventionRiskReviewRounds = pgTable("prevention_risk_review_rounds", {
  id: text("id").primaryKey(),
  matrixId: text("matrix_id").notNull().references(() => preventionRiskMatrices.id, { onDelete: "cascade" }),
  roundNumber: integer("round_number").notNull(),
  stage: text("stage").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  snapshotSha256: text("snapshot_sha256").notNull(),
  submittedByUserId: text("submitted_by_user_id").notNull().references(() => users.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }),
  openedByUserId: text("opened_by_user_id").references(() => users.id),
  decision: text("decision"),
  decidedByUserId: text("decided_by_user_id").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" }),
  decisionComment: text("decision_comment"),
}, (table) => [
  uniqueIndex("prevention_risk_review_rounds_matrix_round_unique").on(table.matrixId, table.roundNumber),
  uniqueIndex("prevention_risk_review_rounds_one_open_unique").on(table.matrixId).where(sql`${table.decision} IS NULL`),
  check("prevention_risk_review_rounds_stage_valid", sql`${table.stage} IN ('technical', 'legal_rrhh')`),
  check("prevention_risk_review_rounds_decision_valid", sql`${table.decision} IS NULL OR ${table.decision} IN ('observed', 'approved')`),
  check("prevention_risk_review_rounds_decision_complete", sql`(${table.decision} IS NULL) = (${table.decidedByUserId} IS NULL)`),
])

/* Versión sellada = hoja "Modificaciones" del RE-04. Inmutable (trigger en la
 * migración 0344): corregir una versión es sellar la siguiente. */
export const preventionRiskMatrixVersions = pgTable("prevention_risk_matrix_versions", {
  id: text("id").primaryKey(),
  matrixId: text("matrix_id").notNull().references(() => preventionRiskMatrices.id, { onDelete: "restrict" }),
  versionNumber: integer("version_number").notNull(),
  period: integer("period"),
  roundId: text("round_id").notNull().references(() => preventionRiskReviewRounds.id, { onDelete: "restrict" }),
  snapshot: jsonb("snapshot").notNull(),
  snapshotSha256: text("snapshot_sha256").notNull(),
  changeSummary: text("change_summary").notNull(),
  elaboratedByUserId: text("elaborated_by_user_id").notNull().references(() => users.id),
  technicalReviewerUserId: text("technical_reviewer_user_id").notNull().references(() => users.id),
  approverUserId: text("approver_user_id").notNull().references(() => users.id),
  elaboratedByName: text("elaborated_by_name").notNull(),
  technicalReviewerName: text("technical_reviewer_name").notNull(),
  approverName: text("approver_name").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_matrix_versions_matrix_number_unique").on(table.matrixId, table.versionNumber),
  check("prevention_risk_matrix_versions_number_positive", sql`${table.versionNumber} > 0`),
])

/* Observación general (entry_id nulo) o sobre una fila. Nunca se borra: la fila
 * puede eliminarse después (set null) y `entry_label` conserva a qué se refería. */
export const preventionRiskObservations = pgTable("prevention_risk_observations", {
  id: text("id").primaryKey(),
  matrixId: text("matrix_id").notNull().references(() => preventionRiskMatrices.id, { onDelete: "cascade" }),
  entryId: text("entry_id").references(() => preventionRiskEntries.id, { onDelete: "set null" }),
  entryLabel: text("entry_label"),
  roundId: text("round_id").notNull().references(() => preventionRiskReviewRounds.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  authorUserId: text("author_user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  status: text("status").notNull().default("open"),
  response: text("response"),
  respondedByUserId: text("responded_by_user_id").references(() => users.id),
  respondedAt: timestamp("responded_at", { withTimezone: true, mode: "string" }),
  resolvedByUserId: text("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_risk_observations_matrix_status_idx").on(table.matrixId, table.status),
  check("prevention_risk_observations_stage_valid", sql`${table.stage} IN ('technical', 'legal_rrhh')`),
  check("prevention_risk_observations_status_valid", sql`${table.status} IN ('open', 'answered', 'resolved')`),
  check("prevention_risk_observations_body_length", sql`length(trim(${table.body})) >= 5`),
  check("prevention_risk_observations_answer_present", sql`${table.status} <> 'answered' OR ${table.response} IS NOT NULL`),
  check("prevention_risk_observations_resolution_present", sql`${table.status} <> 'resolved' OR ${table.resolvedByUserId} IS NOT NULL`),
])

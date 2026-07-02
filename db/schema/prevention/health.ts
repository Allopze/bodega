import { relations, sql } from "drizzle-orm"
import { check, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { workers } from "../worksites"

export const healthExams = pgTable("health_exams", {
  id:          text("id").primaryKey(),
  workerId:    text("worker_id").notNull().references(() => workers.id),
  type:        text("type").notNull(),
  protocolId:  text("protocol_id"),
  performedAt: text("performed_at").notNull(),
  result:      text("result").notNull().default("pendiente"),
  expiresAt:   text("expires_at"),
  evidenceUrl: text("evidence_url"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("health_exams_worker_type_expires_idx").on(table.workerId, table.type, table.expiresAt),
  check("health_exams_result_non_empty", sql`length(${table.result}) > 0`),
])

export const healthAptitudes = pgTable("health_aptitudes", {
  id:           text("id").primaryKey(),
  workerId:     text("worker_id").notNull().references(() => workers.id),
  examId:       text("exam_id").references(() => healthExams.id),
  position:     text("position").notNull(),
  aptitude:     text("aptitude").notNull(),
  restrictions: jsonb("restrictions").notNull(),
  validUntil:   text("valid_until"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("health_aptitudes_worker_position_valid_idx").on(table.workerId, table.position, table.validUntil),
  check("health_aptitudes_aptitude_valid", sql`${table.aptitude} IN ('apto', 'apto_con_restricciones', 'no_apto')`),
])

export const healthRestrictions = pgTable("health_restrictions", {
  id:            text("id").primaryKey(),
  workerId:      text("worker_id").notNull().references(() => workers.id),
  kind:          text("kind").notNull(),
  description:   text("description").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo:   text("effective_to"),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("health_restrictions_worker_to_idx").on(table.workerId, table.effectiveTo),
])

export const minsalProtocols = pgTable("minsal_protocols", {
  id:                   text("id").primaryKey(),
  code:                 text("code").notNull().unique(),
  name:                 text("name").notNull(),
  legalFramework:       text("legal_framework").notNull(),
  appliesToPositions:   jsonb("applies_to_positions").notNull(),
  periodicityMonths:    integer("periodicity_months").notNull(),
  createdAt:            timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:            timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export const protocolApplications = pgTable("protocol_applications", {
  id:                  text("id").primaryKey(),
  workerId:             text("worker_id").notNull().references(() => workers.id),
  protocolId:           text("protocol_id").notNull().references(() => minsalProtocols.id),
  startedAt:            text("started_at").notNull(),
  lastEvaluationAt:     text("last_evaluation_at"),
  nextDueAt:            text("next_due_at"),
  status:               text("status").notNull().default("vigente"),
  createdAt:            timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:            timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("protocol_applications_worker_protocol_unique").on(table.workerId, table.protocolId),
  index("protocol_applications_due_idx").on(table.nextDueAt, table.status),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const healthExamsRelations = relations(healthExams, ({ one }) => ({
  worker: one(workers, { fields: [healthExams.workerId], references: [workers.id] }),
}))

export const healthAptitudesRelations = relations(healthAptitudes, ({ one }) => ({
  worker: one(workers, { fields: [healthAptitudes.workerId], references: [workers.id] }),
  exam:   one(healthExams, { fields: [healthAptitudes.examId], references: [healthExams.id] }),
}))

export const healthRestrictionsRelations = relations(healthRestrictions, ({ one }) => ({
  worker: one(workers, { fields: [healthRestrictions.workerId], references: [workers.id] }),
}))

export const minsalProtocolsRelations = relations(minsalProtocols, ({ many }) => ({
  applications: many(protocolApplications),
}))

export const protocolApplicationsRelations = relations(protocolApplications, ({ one }) => ({
  worker:   one(workers, { fields: [protocolApplications.workerId], references: [workers.id] }),
  protocol: one(minsalProtocols, { fields: [protocolApplications.protocolId], references: [minsalProtocols.id] }),
}))

/* ── Types ───────────────────────────────────────────────────────────────── */
export type HealthExam = typeof healthExams.$inferSelect
export type NewHealthExam = typeof healthExams.$inferInsert
export type HealthAptitude = typeof healthAptitudes.$inferSelect
export type NewHealthAptitude = typeof healthAptitudes.$inferInsert
export type HealthRestriction = typeof healthRestrictions.$inferSelect
export type NewHealthRestriction = typeof healthRestrictions.$inferInsert
export type MinsalProtocol = typeof minsalProtocols.$inferSelect
export type NewMinsalProtocol = typeof minsalProtocols.$inferInsert
export type ProtocolApplication = typeof protocolApplications.$inferSelect
export type NewProtocolApplication = typeof protocolApplications.$inferInsert

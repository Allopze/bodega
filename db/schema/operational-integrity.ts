import { relations, sql } from "drizzle-orm"
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"

export const operationalIntegrityCases = pgTable("operational_integrity_cases", {
  id: text("id").primaryKey(),
  caseKey: text("case_key").notNull().unique(),
  domain: text("domain").notNull().$type<"stock" | "receiving" | "purchasing">(),
  code: text("code").notNull(),
  severity: text("severity").notNull().$type<"warning" | "high" | "critical">(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  firstDetectedAt: timestamp("first_detected_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("operational_integrity_cases_domain_valid", sql`
    ${table.domain} IN ('stock', 'receiving', 'purchasing')
  `),
  check("operational_integrity_cases_severity_valid", sql`
    ${table.severity} IN ('warning', 'high', 'critical')
  `),
  index("operational_integrity_cases_worksite_detected_idx")
    .on(table.worksiteId, table.firstDetectedAt),
  index("operational_integrity_cases_domain_code_idx").on(table.domain, table.code),
])

export const operationalIntegrityObservations = pgTable("operational_integrity_observations", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull()
    .references(() => operationalIntegrityCases.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("operational_integrity_observation_fingerprint_unique")
    .on(table.caseId, table.fingerprint),
])

export const operationalIntegrityCaseEvents = pgTable("operational_integrity_case_events", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull()
    .references(() => operationalIntegrityCases.id, { onDelete: "cascade" }),
  observationId: text("observation_id").notNull()
    .references(() => operationalIntegrityObservations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().$type<"acknowledged" | "verified_resolved">(),
  reason: text("reason").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  actorUserId: text("actor_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("operational_integrity_case_events_kind_valid", sql`
    ${table.kind} IN ('acknowledged', 'verified_resolved')
  `),
  check("operational_integrity_case_events_reason_length", sql`
    char_length(trim(${table.reason})) BETWEEN 10 AND 2000
  `),
  uniqueIndex("operational_integrity_case_events_case_observation_kind_unique")
    .on(table.caseId, table.observationId, table.kind),
  index("operational_integrity_case_events_case_created_idx").on(table.caseId, table.createdAt),
])

export const operationalIntegrityCasesRelations = relations(operationalIntegrityCases, ({ one, many }) => ({
  worksite: one(worksites, {
    fields: [operationalIntegrityCases.worksiteId],
    references: [worksites.id],
  }),
  observations: many(operationalIntegrityObservations),
  events: many(operationalIntegrityCaseEvents),
}))

export const operationalIntegrityObservationsRelations = relations(
  operationalIntegrityObservations,
  ({ one, many }) => ({
    case: one(operationalIntegrityCases, {
      fields: [operationalIntegrityObservations.caseId],
      references: [operationalIntegrityCases.id],
    }),
    events: many(operationalIntegrityCaseEvents),
  }),
)

export const operationalIntegrityCaseEventsRelations = relations(operationalIntegrityCaseEvents, ({ one }) => ({
  case: one(operationalIntegrityCases, {
    fields: [operationalIntegrityCaseEvents.caseId],
    references: [operationalIntegrityCases.id],
  }),
  observation: one(operationalIntegrityObservations, {
    fields: [operationalIntegrityCaseEvents.observationId],
    references: [operationalIntegrityObservations.id],
  }),
  actorUser: one(users, {
    fields: [operationalIntegrityCaseEvents.actorUserId],
    references: [users.id],
  }),
}))

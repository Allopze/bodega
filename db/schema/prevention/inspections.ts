import { relations } from "drizzle-orm"
import { boolean, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites, workers } from "../worksites"

export const inspectionTemplates = pgTable("inspection_templates", {
  id:            text("id").primaryKey(),
  code:          text("code").notNull().unique(),
  title:         text("title").notNull(),
  scope:         text("scope").notNull(),
  items:         jsonb("items").notNull(),
  frequency:     text("frequency").notNull().default("mensual"),
  requiresPhoto: boolean("requires_photo").notNull().default(false),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("inspection_templates_frequency_idx").on(table.frequency),
])

export const inspectionRuns = pgTable("inspection_runs", {
  id:          text("id").primaryKey(),
  templateId:  text("template_id").notNull().references(() => inspectionTemplates.id),
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  inspectorId: text("inspector_id").notNull().references(() => users.id),
  startedAt:   timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  status:      text("status").notNull().default("open"),
  signature:   text("signature"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("inspection_runs_worksite_status_idx").on(table.worksiteId, table.status),
  index("inspection_runs_inspector_idx").on(table.inspectorId),
])

export const inspectionItems = pgTable("inspection_items", {
  id:        text("id").primaryKey(),
  runId:     text("run_id").notNull().references(() => inspectionRuns.id, { onDelete: "cascade" }),
  itemKey:   text("item_key").notNull(),
  expected:  text("expected").notNull(),
  observed:  text("observed"),
  status:    text("status").notNull().default("pendiente"),
  note:      text("note"),
  photoUrl:  text("photo_url"),
  closedAt:  timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("inspection_items_run_key_unique").on(table.runId, table.itemKey),
  index("inspection_items_status_idx").on(table.status),
])

export const behavioralObservations = pgTable("behavioral_observations", {
  id:                 text("id").primaryKey(),
  worksiteId:         text("worksite_id").notNull().references(() => worksites.id),
  observerId:         text("observer_id").notNull().references(() => users.id),
  workerId:           text("worker_id").references(() => workers.id),
  antecedent:         text("antecedent").notNull(),
  behavior:           text("behavior").notNull(),
  consequence:        text("consequence").notNull(),
  severity:           text("severity").notNull().default("bajo"),
  runId:              text("run_id").references(() => inspectionRuns.id),
  correctiveActionId: text("corrective_action_id"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("behavioral_observations_worksite_severity_idx").on(table.worksiteId, table.severity),
  index("behavioral_observations_run_idx").on(table.runId),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const inspectionTemplatesRelations = relations(inspectionTemplates, ({ many }) => ({
  runs: many(inspectionRuns),
}))

export const inspectionRunsRelations = relations(inspectionRuns, ({ one, many }) => ({
  template:  one(inspectionTemplates, { fields: [inspectionRuns.templateId], references: [inspectionTemplates.id] }),
  worksite:  one(worksites, { fields: [inspectionRuns.worksiteId], references: [worksites.id] }),
  inspector: one(users, { fields: [inspectionRuns.inspectorId], references: [users.id] }),
  items:     many(inspectionItems),
  observations: many(behavioralObservations),
}))

export const inspectionItemsRelations = relations(inspectionItems, ({ one }) => ({
  run: one(inspectionRuns, { fields: [inspectionItems.runId], references: [inspectionRuns.id] }),
}))

export const behavioralObservationsRelations = relations(behavioralObservations, ({ one }) => ({
  worksite: one(worksites, { fields: [behavioralObservations.worksiteId], references: [worksites.id] }),
  observer: one(users, { fields: [behavioralObservations.observerId], references: [users.id] }),
  worker:   one(workers, { fields: [behavioralObservations.workerId], references: [workers.id] }),
  run:      one(inspectionRuns, { fields: [behavioralObservations.runId], references: [inspectionRuns.id] }),
}))

/* ── Types ───────────────────────────────────────────────────────────────── */
export type InspectionTemplate = typeof inspectionTemplates.$inferSelect
export type NewInspectionTemplate = typeof inspectionTemplates.$inferInsert
export type InspectionRun = typeof inspectionRuns.$inferSelect
export type NewInspectionRun = typeof inspectionRuns.$inferInsert
export type InspectionItem = typeof inspectionItems.$inferSelect
export type NewInspectionItem = typeof inspectionItems.$inferInsert
export type BehavioralObservation = typeof behavioralObservations.$inferSelect
export type NewBehavioralObservation = typeof behavioralObservations.$inferInsert

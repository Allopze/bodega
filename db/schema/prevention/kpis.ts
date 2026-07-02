import { relations } from "drizzle-orm"
import { index, numeric, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { worksites } from "../worksites"

export const kpiSnapshots = pgTable("kpi_snapshots", {
  id:         text("id").primaryKey(),
  worksiteId: text("worksite_id"),
  period:     text("period").notNull(),
  metric:     text("metric").notNull(),
  value:      numeric("value", { precision: 15, scale: 4, mode: "number" }).notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true, mode: "string" }).notNull(),
  source:     text("source").notNull(),
}, (table) => [
  uniqueIndex("kpi_snapshots_ws_period_metric_unique").on(table.worksiteId, table.period, table.metric),
  index("kpi_snapshots_period_idx").on(table.period),
])

export const laborHours = pgTable("labor_hours", {
  id:         text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id),
  period:     text("period").notNull(),
  hours:      numeric("hours", { precision: 12, scale: 2, mode: "number" }).notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("labor_hours_ws_period_unique").on(table.worksiteId, table.period),
])

export const kpiSnapshotsRelations = relations(kpiSnapshots, ({ one }) => ({
  worksite: one(worksites, { fields: [kpiSnapshots.worksiteId], references: [worksites.id] }),
}))

export const laborHoursRelations = relations(laborHours, ({ one }) => ({
  worksite: one(worksites, { fields: [laborHours.worksiteId], references: [worksites.id] }),
}))

export type KpiSnapshot = typeof kpiSnapshots.$inferSelect
export type NewKpiSnapshot = typeof kpiSnapshots.$inferInsert
export type LaborHours = typeof laborHours.$inferSelect
export type NewLaborHours = typeof laborHours.$inferInsert

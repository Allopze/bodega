import { relations } from "drizzle-orm"
import { index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { worksites, workers } from "../worksites"

export const eppPositionMatrix = pgTable("epp_position_matrix", {
  id:            text("id").primaryKey(),
  worksiteId:    text("worksite_id").notNull().references(() => worksites.id),
  position:      text("position").notNull(),
  eppProductId:  text("epp_product_id").notNull(),
  riskId:        text("risk_id"),
  requiredSince: text("required_since").notNull(),
  notes:         text("notes"),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("epp_position_matrix_ws_pos_prod_unique").on(table.worksiteId, table.position, table.eppProductId),
])

export const eppLifecyclePolicies = pgTable("epp_lifecycle_policies", {
  eppProductId:       text("epp_product_id").primaryKey(),
  lifespanDays:       integer("lifespan_days").notNull(),
  maxReuses:          integer("max_reuses"),
  inspectionChecklist: jsonb("inspection_checklist").notNull(),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export const eppRecambioLog = pgTable("epp_recambio_log", {
  id:             text("id").primaryKey(),
  workerId:       text("worker_id").notNull().references(() => workers.id),
  eppProductId:   text("epp_product_id").notNull().references(() => eppLifecyclePolicies.eppProductId),
  deliveredAt:    timestamp("delivered_at", { withTimezone: true, mode: "string" }).notNull(),
  expiresAt:      timestamp("expires_at", { withTimezone: true, mode: "string" }),
  returnedAt:     timestamp("returned_at", { withTimezone: true, mode: "string" }),
  disposition:    text("disposition"),
  evidenceUrl:    text("evidence_url"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true, mode: "string" }),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("epp_recambio_log_worker_expires_idx").on(table.workerId, table.expiresAt),
])

export const eppStockThresholds = pgTable("epp_stock_thresholds", {
  id:            text("id").primaryKey(),
  worksiteId:    text("worksite_id").notNull().references(() => worksites.id),
  eppProductId:  text("epp_product_id").notNull(),
  minStock:      integer("min_stock").notNull().default(0),
  criticalStock: integer("critical_stock").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("epp_stock_thresholds_ws_prod_unique").on(table.worksiteId, table.eppProductId),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const eppPositionMatrixRelations = relations(eppPositionMatrix, ({ one }) => ({
  worksite: one(worksites, { fields: [eppPositionMatrix.worksiteId], references: [worksites.id] }),
}))

export const eppRecambioLogRelations = relations(eppRecambioLog, ({ one }) => ({
  worker:   one(workers, { fields: [eppRecambioLog.workerId], references: [workers.id] }),
  product:  one(eppLifecyclePolicies, { fields: [eppRecambioLog.eppProductId], references: [eppLifecyclePolicies.eppProductId] }),
}))

export const eppStockThresholdsRelations = relations(eppStockThresholds, ({ one }) => ({
  worksite: one(worksites, { fields: [eppStockThresholds.worksiteId], references: [worksites.id] }),
}))

/* ── Types ───────────────────────────────────────────────────────────────── */
export type EppPositionEntry = typeof eppPositionMatrix.$inferSelect
export type NewEppPositionEntry = typeof eppPositionMatrix.$inferInsert
export type EppLifecyclePolicy = typeof eppLifecyclePolicies.$inferSelect
export type NewEppLifecyclePolicy = typeof eppLifecyclePolicies.$inferInsert
export type EppRecambioEntry = typeof eppRecambioLog.$inferSelect
export type NewEppRecambioEntry = typeof eppRecambioLog.$inferInsert
export type EppStockThreshold = typeof eppStockThresholds.$inferSelect
export type NewEppStockThreshold = typeof eppStockThresholds.$inferInsert

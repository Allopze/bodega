import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites, workers } from "../worksites"

export const iperMatrices = pgTable("iper_matrices", {
  id:            text("id").primaryKey(),
  worksiteId:    text("worksite_id").notNull().references(() => worksites.id),
  code:          text("code").notNull(),
  version:       integer("version").notNull(),
  title:         text("title").notNull(),
  status:        text("status").notNull().default("draft"),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo:   text("effective_to"),
  createdBy:     text("created_by").notNull().references(() => users.id),
  closedBy:      text("closed_by").references(() => users.id),
  closedAt:      timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("iper_matrices_code_version_unique").on(table.code, table.version),
  index("iper_matrices_worksite_status_idx").on(table.worksiteId, table.status),
  check("iper_matrices_status_valid", sql`${table.status} IN ('draft', 'active', 'closed')`),
])

export const iperRiskItems = pgTable("iper_risk_items", {
  id:                  text("id").primaryKey(),
  matrixId:            text("matrix_id").notNull().references(() => iperMatrices.id, { onDelete: "cascade" }),
  process:             text("process").notNull(),
  task:                text("task").notNull(),
  hazard:              text("hazard").notNull(),
  consequence:         text("consequence").notNull(),
  initialProbability:  integer("initial_probability").notNull(),
  initialSeverity:     integer("initial_severity").notNull(),
  initialRiskScore:    integer("initial_risk_score").notNull(),
  initialRiskLevel:    text("initial_risk_level").notNull(),
  controls:            jsonb("controls").notNull(),
  residualProbability: integer("residual_probability").notNull(),
  residualSeverity:    integer("residual_severity").notNull(),
  residualRiskScore:   integer("residual_risk_score").notNull(),
  residualRiskLevel:   text("residual_risk_level").notNull(),
  responsible:         text("responsible").notNull(),
  requiresTraining:    boolean("requires_training").notNull().default(false),
  requiresPpa:         boolean("requires_ppa").notNull().default(false),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("iper_risk_items_matrix_idx").on(table.matrixId),
  index("iper_risk_items_residual_level_idx").on(table.residualRiskLevel),
  check("iper_risk_items_initial_level_valid", sql`${table.initialRiskLevel} IN ('bajo', 'medio', 'alto', 'critico')`),
  check("iper_risk_items_residual_level_valid", sql`${table.residualRiskLevel} IN ('bajo', 'medio', 'alto', 'critico')`),
  check("iper_risk_items_initial_probability_range", sql`${table.initialProbability} BETWEEN 1 AND 5`),
  check("iper_risk_items_initial_severity_range", sql`${table.initialSeverity} BETWEEN 1 AND 5`),
  check("iper_risk_items_residual_probability_range", sql`${table.residualProbability} BETWEEN 1 AND 5`),
  check("iper_risk_items_residual_severity_range", sql`${table.residualSeverity} BETWEEN 1 AND 5`),
])

export const iperMatricesRelations = relations(iperMatrices, ({ one, many }) => ({
  worksite: one(worksites, { fields: [iperMatrices.worksiteId], references: [worksites.id] }),
  creator:  one(users, { fields: [iperMatrices.createdBy], references: [users.id] }),
  items:    many(iperRiskItems),
}))

export const iperRiskItemsRelations = relations(iperRiskItems, ({ one }) => ({
  matrix: one(iperMatrices, { fields: [iperRiskItems.matrixId], references: [iperMatrices.id] }),
}))

export type IperMatrix    = typeof iperMatrices.$inferSelect
export type NewIperMatrix = typeof iperMatrices.$inferInsert
export type IperRiskItem  = typeof iperRiskItems.$inferSelect
export type NewIperRiskItem = typeof iperRiskItems.$inferInsert

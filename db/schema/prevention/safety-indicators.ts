import { relations, sql } from "drizzle-orm"
import { check, index, integer, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
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
])

/** Cierre administrativo de un mes; el registro del indicador no se duplica. */
export const safetyIndicatorPeriods = pgTable("safety_indicator_periods", {
  id:           text("id").primaryKey(),
  worksiteId:   text("worksite_id").notNull().references(() => worksites.id),
  year:         integer("year").notNull(),
  month:        integer("month").notNull(),
  closedByUserId: text("closed_by_user_id").notNull().references(() => users.id),
  closedAt:     timestamp("closed_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("safety_indicator_periods_worksite_period_unique").on(table.worksiteId, table.year, table.month),
  check("safety_indicator_periods_month_check", sql`${table.month} BETWEEN 1 AND 12`),
  check("safety_indicator_periods_year_check", sql`${table.year} BETWEEN 2024 AND 2100`),
])

export const safetyIndicatorsRelations = relations(safetyIndicators, ({ one }) => ({
  worksite:        one(worksites, { fields: [safetyIndicators.worksiteId], references: [worksites.id] }),
  updatedByUser:   one(users, { fields: [safetyIndicators.updatedByUserId], references: [users.id] }),
}))

export const safetyIndicatorPeriodsRelations = relations(safetyIndicatorPeriods, ({ one }) => ({
  worksite: one(worksites, { fields: [safetyIndicatorPeriods.worksiteId], references: [worksites.id] }),
  closedByUser: one(users, { fields: [safetyIndicatorPeriods.closedByUserId], references: [users.id] }),
}))

export type SafetyIndicator = typeof safetyIndicators.$inferSelect
export type NewSafetyIndicator = typeof safetyIndicators.$inferInsert
export type SafetyIndicatorPeriod = typeof safetyIndicatorPeriods.$inferSelect

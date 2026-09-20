import { relations, sql } from "drizzle-orm"
import { boolean, check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { eppTypes } from "../epp-types"
import { eppProductFamilies } from "../products"
import { users } from "../users"
import { worksites } from "../worksites"
import { preventionLegalRequirements, preventionRiskEntries } from "./risk-legal"

/* ── Matriz de obligatoriedad de EPP ──────────────────────────────────────
 * Mirror deliberado de `prevention_competency_requirements`: es el mismo
 * problema (persona × requisito por cargo/faena/tarea → brecha) ya resuelto
 * para competencias. El catálogo técnico (certificación, vida útil, talla)
 * y la entrega real con acuse ya existen en Bodega (`epp_product_families`,
 * `deliveries`/`delivery_items`) — esta tabla sólo agrega la capa de
 * obligatoriedad que faltaba, sin duplicar nada de eso.
 */
export const preventionEppRequirements = pgTable("prevention_epp_requirements", {
  id:                 text("id").primaryKey(),
  eppTypeId:          text("epp_type_id").notNull().references(() => eppTypes.id, { onDelete: "restrict" }),
  scopeType:          text("scope_type").notNull(),
  scopeValue:         text("scope_value"),
  worksiteId:         text("worksite_id").references(() => worksites.id, { onDelete: "cascade" }),
  enforcement:        text("enforcement").notNull().default("warning"),
  reason:             text("reason").notNull(),
  legalRequirementId: text("legal_requirement_id").references(() => preventionLegalRequirements.id, { onDelete: "set null" }),
  riskEntryId:        text("risk_entry_id").references(() => preventionRiskEntries.id, { onDelete: "set null" }),
  preferredFamilyId:  text("preferred_family_id").references(() => eppProductFamilies.id, { onDelete: "set null" }),
  isActive:           boolean("is_active").notNull().default(true),
  createdByUserId:    text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_epp_requirement_scope_idx").on(table.scopeType, table.isActive),
  index("prevention_epp_requirement_worksite_idx").on(table.worksiteId, table.isActive),
  check("prevention_epp_requirement_scope_valid", sql`${table.scopeType} IN ('global', 'worksite', 'position', 'task')`),
  check("prevention_epp_requirement_enforcement_valid", sql`${table.enforcement} IN ('blocking', 'warning')`),
  check("prevention_epp_requirement_reason_valid", sql`length(${table.reason}) >= 10`),
  check("prevention_epp_requirement_scope_value_present", sql`${table.scopeType} IN ('global', 'worksite') OR length(${table.scopeValue}) >= 1`),
])


/* ── Relations ────────────────────────────────────────────────────────────── */
export const preventionEppRequirementsRelations = relations(preventionEppRequirements, ({ one }) => ({
  eppType: one(eppTypes, { fields: [preventionEppRequirements.eppTypeId], references: [eppTypes.id] }),
  worksite: one(worksites, { fields: [preventionEppRequirements.worksiteId], references: [worksites.id] }),
  legalRequirement: one(preventionLegalRequirements, { fields: [preventionEppRequirements.legalRequirementId], references: [preventionLegalRequirements.id] }),
  riskEntry: one(preventionRiskEntries, { fields: [preventionEppRequirements.riskEntryId], references: [preventionRiskEntries.id] }),
  preferredFamily: one(eppProductFamilies, { fields: [preventionEppRequirements.preferredFamilyId], references: [eppProductFamilies.id] }),
}))

export type PreventionEppRequirement = typeof preventionEppRequirements.$inferSelect

import { relations, sql } from "drizzle-orm"
import { check, index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { dteDocuments } from "./dte"
import { fuelCycleMovements } from "./fuel-cycle"
import { fuelLoads } from "./fuel-invoices"
import { fuelProviderTransactions } from "./fuel-integrations"
import { users } from "./users"

/**
 * Evidencia de conciliación entre una fila externa y cada objeto interno que
 * explica esa fila. Hay una fila por tipo de vínculo para permitir que una
 * factura mensual DTE cubra N transacciones del proveedor sin colgar el DTE de
 * una sola `fuel_load`.
 */
export const fuelReconciliationLinks = pgTable("fuel_reconciliation_links", {
  id: text("id").primaryKey(),
  providerTransactionId: text("provider_transaction_id").notNull().references(() => fuelProviderTransactions.id, { onDelete: "cascade" }),
  linkType: text("link_type").notNull(),
  fuelLoadId: text("fuel_load_id").references(() => fuelLoads.id, { onDelete: "set null" }),
  cycleMovementId: text("cycle_movement_id").references(() => fuelCycleMovements.id, { onDelete: "set null" }),
  dteDocumentId: text("dte_document_id").references(() => dteDocuments.id, { onDelete: "set null" }),
  status: text("status").notNull().default("unmatched"),
  matchMethod: text("match_method"),
  litersDelta: numeric("liters_delta", { precision: 14, scale: 4, mode: "number" }),
  amountDelta: numeric("amount_delta", { precision: 14, scale: 2, mode: "number" }),
  toleranceLiters: numeric("tolerance_liters", { precision: 14, scale: 4, mode: "number" }).notNull().default(0),
  toleranceAmount: numeric("tolerance_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  reason: text("reason"),
  decidedBy: text("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_reconciliation_links_type_valid", sql`${table.linkType} IN ('fuel_load', 'cycle_movement', 'dte')`),
  check("fuel_reconciliation_links_status_valid", sql`${table.status} IN ('matched', 'ambiguous', 'unmatched', 'accepted_exception')`),
  check("fuel_reconciliation_links_target_shape_valid", sql`
    (${table.linkType} = 'fuel_load' AND ${table.fuelLoadId} IS NOT NULL AND ${table.cycleMovementId} IS NULL AND ${table.dteDocumentId} IS NULL)
    OR (${table.linkType} = 'cycle_movement' AND ${table.cycleMovementId} IS NOT NULL AND ${table.fuelLoadId} IS NULL AND ${table.dteDocumentId} IS NULL)
    OR (${table.linkType} = 'dte' AND ${table.dteDocumentId} IS NOT NULL AND ${table.fuelLoadId} IS NULL AND ${table.cycleMovementId} IS NULL)
    OR (${table.status} IN ('ambiguous', 'unmatched') AND ${table.fuelLoadId} IS NULL AND ${table.cycleMovementId} IS NULL AND ${table.dteDocumentId} IS NULL)
  `),
  uniqueIndex("fuel_reconciliation_links_target_unique")
    .on(table.providerTransactionId, table.linkType, table.fuelLoadId, table.cycleMovementId, table.dteDocumentId),
  index("fuel_reconciliation_links_transaction_idx").on(table.providerTransactionId),
  index("fuel_reconciliation_links_status_idx").on(table.status),
  index("fuel_reconciliation_links_dte_idx").on(table.dteDocumentId),
])

export const fuelReconciliationLinksRelations = relations(fuelReconciliationLinks, ({ one }) => ({
  providerTransaction: one(fuelProviderTransactions, { fields: [fuelReconciliationLinks.providerTransactionId], references: [fuelProviderTransactions.id] }),
  fuelLoad: one(fuelLoads, { fields: [fuelReconciliationLinks.fuelLoadId], references: [fuelLoads.id] }),
  cycleMovement: one(fuelCycleMovements, { fields: [fuelReconciliationLinks.cycleMovementId], references: [fuelCycleMovements.id] }),
  dteDocument: one(dteDocuments, { fields: [fuelReconciliationLinks.dteDocumentId], references: [dteDocuments.id] }),
  decider: one(users, { fields: [fuelReconciliationLinks.decidedBy], references: [users.id] }),
}))

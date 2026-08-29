import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"
import { fuelVehicles } from "./fuel-vehicles"
import { fuelProducts } from "./fuel-products"
import { fuelSuppliers } from "./fuel-suppliers"

export const fuelProviderSyncRuns = pgTable("fuel_provider_sync_runs", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  trigger: text("trigger").notNull().default("manual"),
  requestedFrom: text("requested_from").notNull(),
  requestedTo: text("requested_to").notNull(),
  receivedFrom: text("received_from"),
  receivedTo: text("received_to"),
  status: text("status").notNull().default("running"),
  correlationId: text("correlation_id").notNull(),
  actorUserId: text("actor_user_id").references(() => users.id),
  pages: integer("pages").notNull().default(0),
  files: integer("files").notNull().default(0),
  rowsReceived: integer("rows_received").notNull().default(0),
  rowsAccepted: integer("rows_accepted").notNull().default(0),
  rowsRejected: integer("rows_rejected").notNull().default(0),
  rowsPending: integer("rows_pending").notNull().default(0),
  rowsReprocessed: integer("rows_reprocessed").notNull().default(0),
  affectedQuantity: numeric("affected_quantity", { precision: 14, scale: 4, mode: "number" }).notNull().default(0),
  affectedAmount: numeric("affected_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  check("fuel_provider_sync_runs_provider_valid", sql`${table.provider} IN ('copec', 'aramco')`),
  check("fuel_provider_sync_runs_trigger_valid", sql`${table.trigger} IN ('manual', 'cron', 'reprocess')`),
  check("fuel_provider_sync_runs_status_valid", sql`${table.status} IN ('running', 'success', 'partial', 'failed')`),
  check("fuel_provider_sync_runs_period_valid", sql`${table.requestedFrom} <= ${table.requestedTo}`),
  check("fuel_provider_sync_runs_counts_valid", sql`
    ${table.rowsReceived} >= 0 AND ${table.rowsAccepted} >= 0 AND
    ${table.rowsRejected} >= 0 AND ${table.rowsPending} >= 0 AND
    ${table.rowsReprocessed} >= 0 AND ${table.affectedQuantity} >= 0 AND
    ${table.affectedAmount} >= 0
  `),
  index("fuel_provider_sync_runs_provider_started_idx").on(table.provider, table.startedAt),
  index("fuel_provider_sync_runs_status_idx").on(table.status),
  index("fuel_provider_sync_runs_correlation_idx").on(table.correlationId),
])

export const fuelProviderTransactions = pgTable("fuel_provider_transactions", {
  id: text("id").primaryKey(),
  syncRunId: text("sync_run_id").notNull().references(() => fuelProviderSyncRuns.id),
  provider: text("provider").notNull(),
  sourceAccount: text("source_account").notNull(),
  supplierId: text("supplier_id").references(() => fuelSuppliers.id),
  identityKey: text("identity_key").notNull(),
  externalId: text("external_id"),
  fingerprint: text("fingerprint").notNull(),
  sourceRowKey: text("source_row_key").notNull(),
  worksiteId: text("worksite_id").references(() => worksites.id),
  vehicleId: text("vehicle_id").references(() => fuelVehicles.id),
  productId: text("product_id").references(() => fuelProducts.id),
  sourceProduct: text("source_product"),
  sourcePlate: text("source_plate"),
  occurredAt: text("occurred_at"),
  quantity: numeric("quantity", { precision: 14, scale: 4, mode: "number" }),
  unitPrice: numeric("unit_price", { precision: 14, scale: 4, mode: "number" }),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }),
  status: text("status").notNull(),
  /**
   * Qué representa la fila: una transacción del proveedor o el agregado de un
   * período.
   *
   * El informe TCT de Copec es un agregado MENSUAL por patente, así que su fila
   * no se puede cruzar contra una carga interna por fecha y monto: la
   * conciliación la salta en vez de marcarla `unmatched`, que sugería un
   * descuadre donde sólo había granularidades distintas.
   */
  granularity: text("granularity").notNull().default("transaction"),
  resolutionCode: text("resolution_code"),
  resolutionMessage: text("resolution_message"),
  rawPayload: jsonb("raw_payload"),
  payloadHash: text("payload_hash").notNull(),
  supersedesId: text("supersedes_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_provider_transactions_provider_valid", sql`${table.provider} IN ('copec', 'aramco')`),
  check("fuel_provider_transactions_status_valid", sql`${table.status} IN ('accepted', 'rejected', 'pending', 'superseded')`),
  check("fuel_provider_transactions_granularity_valid", sql`${table.granularity} IN ('transaction', 'period_aggregate')`),
  check("fuel_provider_transactions_values_valid", sql`
    (${table.quantity} IS NULL OR ${table.quantity} >= 0) AND
    (${table.amount} IS NULL OR ${table.amount} >= 0) AND
    (${table.unitPrice} IS NULL OR ${table.unitPrice} >= 0)
  `),
  uniqueIndex("fuel_provider_transactions_identity_unique")
    .on(table.provider, table.sourceAccount, table.identityKey),
  index("fuel_provider_transactions_run_idx").on(table.syncRunId),
  index("fuel_provider_transactions_worksite_idx").on(table.worksiteId),
  index("fuel_provider_transactions_status_idx").on(table.status),
  index("fuel_provider_transactions_occurred_idx").on(table.occurredAt),
  index("fuel_provider_transactions_source_plate_idx").on(table.sourcePlate),
])

export const fuelProviderRejections = pgTable("fuel_provider_rejections", {
  id: text("id").primaryKey(),
  syncRunId: text("sync_run_id").notNull().references(() => fuelProviderSyncRuns.id),
  provider: text("provider").notNull(),
  sourceAccount: text("source_account").notNull(),
  sourceRowKey: text("source_row_key").notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  sourceProduct: text("source_product"),
  sourcePlate: text("source_plate"),
  occurredAt: text("occurred_at"),
  quantity: numeric("quantity", { precision: 14, scale: 4, mode: "number" }),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }),
  worksiteId: text("worksite_id").references(() => worksites.id),
  status: text("status").notNull().default("open"),
  rawPayload: jsonb("raw_payload"),
  resolvedBy: text("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_provider_rejections_provider_valid", sql`${table.provider} IN ('copec', 'aramco')`),
  check("fuel_provider_rejections_status_valid", sql`${table.status} IN ('open', 'resolved', 'dismissed')`),
  uniqueIndex("fuel_provider_rejections_source_unique")
    .on(table.provider, table.sourceAccount, table.sourceRowKey, table.code),
  index("fuel_provider_rejections_run_idx").on(table.syncRunId),
  index("fuel_provider_rejections_worksite_status_idx").on(table.worksiteId, table.status),
])

/** Versioned manual source-to-vehicle/faena decisions, independent of projections. */
export const fuelProviderMappings = pgTable("fuel_provider_mappings", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  sourceAccount: text("source_account").notNull(),
  externalKey: text("external_key").notNull(),
  normalizedValue: text("normalized_value").notNull(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id),
  vehicleId: text("vehicle_id").references(() => fuelVehicles.id),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  decidedBy: text("decided_by").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"),
  supersedesId: text("supersedes_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_provider_mappings_provider_valid", sql`${table.provider} IN ('copec', 'aramco')`),
  uniqueIndex("fuel_provider_mappings_version_unique").on(table.provider, table.sourceAccount, table.externalKey, table.version),
  uniqueIndex("fuel_provider_mappings_active_unique")
    .on(table.provider, table.sourceAccount, table.externalKey)
    .where(sql`${table.isActive}`),
  index("fuel_provider_mappings_worksite_idx").on(table.worksiteId),
  index("fuel_provider_mappings_vehicle_idx").on(table.vehicleId),
])

export const fuelProviderSyncRunsRelations = relations(fuelProviderSyncRuns, ({ one, many }) => ({
  actor: one(users, { fields: [fuelProviderSyncRuns.actorUserId], references: [users.id] }),
  transactions: many(fuelProviderTransactions),
  rejections: many(fuelProviderRejections),
}))

export const fuelProviderTransactionsRelations = relations(fuelProviderTransactions, ({ one }) => ({
  run: one(fuelProviderSyncRuns, { fields: [fuelProviderTransactions.syncRunId], references: [fuelProviderSyncRuns.id] }),
  worksite: one(worksites, { fields: [fuelProviderTransactions.worksiteId], references: [worksites.id] }),
  vehicle: one(fuelVehicles, { fields: [fuelProviderTransactions.vehicleId], references: [fuelVehicles.id] }),
  product: one(fuelProducts, { fields: [fuelProviderTransactions.productId], references: [fuelProducts.id] }),
  supplier: one(fuelSuppliers, { fields: [fuelProviderTransactions.supplierId], references: [fuelSuppliers.id] }),
}))

export const fuelProviderRejectionsRelations = relations(fuelProviderRejections, ({ one }) => ({
  run: one(fuelProviderSyncRuns, { fields: [fuelProviderRejections.syncRunId], references: [fuelProviderSyncRuns.id] }),
  worksite: one(worksites, { fields: [fuelProviderRejections.worksiteId], references: [worksites.id] }),
  resolver: one(users, { fields: [fuelProviderRejections.resolvedBy], references: [users.id] }),
}))

export const fuelProviderMappingsRelations = relations(fuelProviderMappings, ({ one }) => ({
  worksite: one(worksites, { fields: [fuelProviderMappings.worksiteId], references: [worksites.id] }),
  vehicle: one(fuelVehicles, { fields: [fuelProviderMappings.vehicleId], references: [fuelVehicles.id] }),
  decider: one(users, { fields: [fuelProviderMappings.decidedBy], references: [users.id] }),
  superseded: one(fuelProviderMappings, { fields: [fuelProviderMappings.supersedesId], references: [fuelProviderMappings.id], relationName: "fuel_mapping_supersession" }),
}))

import { relations, sql } from "drizzle-orm"
import { boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"
import { fuelVehicles } from "./fuel-vehicles"
import { fuelProducts } from "./fuel-products"
import { fuelSuppliers } from "./fuel-suppliers"
import { fuelStorageLocations } from "./fuel-cycle"

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
  documentNumber: text("document_number"),
  fingerprint: text("fingerprint").notNull(),
  sourceRowKey: text("source_row_key").notNull(),
  worksiteId: text("worksite_id").references(() => worksites.id),
  vehicleId: text("vehicle_id").references(() => fuelVehicles.id),
  storageLocationId: text("storage_location_id"),
  productId: text("product_id").references(() => fuelProducts.id),
  sourceProduct: text("source_product"),
  sourcePlate: text("source_plate"),
  occurredAt: text("occurred_at"),
  quantity: numeric("quantity", { precision: 14, scale: 4, mode: "number" }),
  unitPrice: numeric("unit_price", { precision: 14, scale: 4, mode: "number" }),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }),
  amountBasis: text("amount_basis").notNull().default("reported"),
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
  check("fuel_provider_transactions_amount_basis_valid", sql`${table.amountBasis} = 'reported'`),
  check("fuel_provider_transactions_values_valid", sql`
    (${table.quantity} IS NULL OR ${table.quantity} >= 0) AND
    (${table.amount} IS NULL OR ${table.amount} >= 0) AND
    (${table.unitPrice} IS NULL OR ${table.unitPrice} >= 0)
  `),
  foreignKey({ name: "fuel_provider_tx_storage_fk", columns: [table.storageLocationId], foreignColumns: [fuelStorageLocations.id] }),
  uniqueIndex("fuel_provider_transactions_identity_unique")
    .on(table.provider, table.sourceAccount, table.identityKey),
  index("fuel_provider_transactions_run_idx").on(table.syncRunId),
  index("fuel_provider_transactions_worksite_idx").on(table.worksiteId),
  index("fuel_provider_transactions_status_idx").on(table.status),
  index("fuel_provider_transactions_occurred_idx").on(table.occurredAt),
  index("fuel_provider_transactions_source_plate_idx").on(table.sourcePlate),
  index("fuel_provider_transactions_document_idx").on(table.provider, table.sourceAccount, table.documentNumber),
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

/** Private, encrypted evidence received from a provider report download. */
export const fuelProviderFiles = pgTable("fuel_provider_files", {
  id: text("id").primaryKey(),
  syncRunId: text("sync_run_id").notNull(),
  provider: text("provider").notNull(),
  sourceAccount: text("source_account").notNull(),
  channel: text("channel").notNull(),
  product: text("product").notNull(),
  periodMonth: text("period_month").notNull(),
  originalFileName: text("original_file_name").notNull(),
  storagePath: text("storage_path").notNull(),
  sourceSha256: text("source_sha256").notNull(),
  encryptedSha256: text("encrypted_sha256").notNull(),
  encryptionIv: text("encryption_iv").notNull(),
  encryptionAuthTag: text("encryption_auth_tag").notNull(),
  encryptionKeyVersion: text("encryption_key_version").notNull(),
  parserVersion: text("parser_version").notNull(),
  sourceBytes: integer("source_bytes").notNull(),
  rowsReceived: integer("rows_received").notNull().default(0),
  rowsAccepted: integer("rows_accepted").notNull().default(0),
  rowsRejected: integer("rows_rejected").notNull().default(0),
  rowsPending: integer("rows_pending").notNull().default(0),
  quantityTotal: numeric("quantity_total", { precision: 14, scale: 4, mode: "number" }).notNull().default(0),
  amountTotal: numeric("amount_total", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("archived"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_provider_files_provider_valid", sql`${table.provider} IN ('copec', 'aramco')`),
  check("fuel_provider_files_channel_valid", sql`${table.channel} IN ('TCT', 'TAE')`),
  check("fuel_provider_files_product_valid", sql`${table.product} IN ('diesel', 'bluemax')`),
  check("fuel_provider_files_status_valid", sql`${table.status} IN ('archived', 'processed', 'invalid')`),
  check("fuel_provider_files_counts_valid", sql`${table.sourceBytes} > 0 AND ${table.rowsReceived} >= 0 AND ${table.rowsAccepted} >= 0 AND ${table.rowsRejected} >= 0 AND ${table.rowsPending} >= 0`),
  foreignKey({ name: "fuel_provider_files_run_fk", columns: [table.syncRunId], foreignColumns: [fuelProviderSyncRuns.id] }),
  uniqueIndex("fuel_provider_files_evidence_unique").on(table.syncRunId, table.channel, table.product, table.periodMonth, table.sourceSha256),
  index("fuel_provider_files_period_idx").on(table.provider, table.sourceAccount, table.channel, table.product, table.periodMonth),
])

/** Per-channel/product/month coverage. A cursor alone never proves completion. */
export const fuelProviderPeriodCoverage = pgTable("fuel_provider_period_coverage", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  sourceAccount: text("source_account").notNull(),
  channel: text("channel").notNull(),
  product: text("product").notNull(),
  periodMonth: text("period_month").notNull(),
  status: text("status").notNull().default("unknown"),
  sourceAvailability: text("source_availability").notNull().default("unknown"),
  syncRunId: text("sync_run_id"),
  sourceFileId: text("source_file_id"),
  rowsReceived: integer("rows_received").notNull().default(0),
  rowsAccepted: integer("rows_accepted").notNull().default(0),
  rowsRejected: integer("rows_rejected").notNull().default(0),
  quantityTotal: numeric("quantity_total", { precision: 14, scale: 4, mode: "number" }).notNull().default(0),
  amountTotal: numeric("amount_total", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  parserVersion: text("parser_version"),
  evidence: text("evidence"),
  evidenceActorUserId: text("evidence_actor_user_id"),
  rowsPending: integer("rows_pending").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_provider_coverage_provider_valid", sql`${table.provider} IN ('copec', 'aramco')`),
  check("fuel_provider_coverage_channel_valid", sql`${table.channel} IN ('TCT', 'TAE')`),
  check("fuel_provider_coverage_product_valid", sql`${table.product} IN ('diesel', 'bluemax')`),
  check("fuel_provider_coverage_status_valid", sql`${table.status} IN ('unknown', 'incomplete', 'failed', 'complete', 'legitimate_empty')`),
  check("fuel_provider_coverage_source_valid", sql`${table.sourceAvailability} IN ('unknown', 'available', 'unavailable')`),
  check("fuel_provider_coverage_period_valid", sql`${table.periodMonth} ~ '^\\d{4}-(0[1-9]|1[0-2])-01$'`),
  check("fuel_provider_coverage_counts_valid", sql`${table.rowsReceived} >= 0 AND ${table.rowsAccepted} >= 0 AND ${table.rowsRejected} >= 0 AND ${table.rowsPending} >= 0`),
  check("fuel_provider_coverage_empty_evidence", sql`${table.status} <> 'legitimate_empty' OR (${table.sourceAvailability} = 'available' AND ${table.evidence} IS NOT NULL AND length(trim(${table.evidence})) > 0 AND ${table.evidenceActorUserId} IS NOT NULL)`),
  foreignKey({ name: "fuel_provider_coverage_run_fk", columns: [table.syncRunId], foreignColumns: [fuelProviderSyncRuns.id] }),
  foreignKey({ name: "fuel_provider_coverage_file_fk", columns: [table.sourceFileId], foreignColumns: [fuelProviderFiles.id] }),
  foreignKey({ name: "fuel_provider_coverage_actor_fk", columns: [table.evidenceActorUserId], foreignColumns: [users.id] }),
  uniqueIndex("fuel_provider_coverage_period_unique").on(table.provider, table.sourceAccount, table.channel, table.product, table.periodMonth),
  index("fuel_provider_coverage_status_idx").on(table.provider, table.status, table.periodMonth),
])

/** Append-only evidence of provider event changes; current ledger rows stay queryable. */
export const fuelProviderEventRevisions = pgTable("fuel_provider_event_revisions", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull(),
  syncRunId: text("sync_run_id").notNull(),
  sourceFileId: text("source_file_id"),
  fingerprint: text("fingerprint").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4, mode: "number" }),
  unitPrice: numeric("unit_price", { precision: 14, scale: 4, mode: "number" }),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }),
  amountBasis: text("amount_basis").notNull().default("reported"),
  status: text("status").notNull(),
  payloadHash: text("payload_hash").notNull(),
  rawPayload: jsonb("raw_payload"),
  observedAt: timestamp("observed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_provider_event_revisions_amount_basis_valid", sql`${table.amountBasis} = 'reported'`),
  check("fuel_provider_event_revisions_status_valid", sql`${table.status} IN ('accepted', 'rejected', 'pending', 'superseded', 'correction_review')`),
  foreignKey({ name: "fuel_provider_event_rev_transaction_fk", columns: [table.transactionId], foreignColumns: [fuelProviderTransactions.id] }),
  foreignKey({ name: "fuel_provider_event_rev_run_fk", columns: [table.syncRunId], foreignColumns: [fuelProviderSyncRuns.id] }),
  foreignKey({ name: "fuel_provider_event_rev_file_fk", columns: [table.sourceFileId], foreignColumns: [fuelProviderFiles.id] }),
  uniqueIndex("fuel_provider_event_revision_unique").on(table.transactionId, table.fingerprint, table.sourceFileId),
  index("fuel_provider_event_revision_observed_idx").on(table.transactionId, table.observedAt),
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
  storageLocation: one(fuelStorageLocations, { fields: [fuelProviderTransactions.storageLocationId], references: [fuelStorageLocations.id] }),
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

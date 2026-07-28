import { relations, sql } from "drizzle-orm"
import { pgTable, text, integer, numeric, jsonb, boolean, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites, workers } from "./worksites"
import { fuelVehicles } from "./fuel-vehicles"
import { fuelProducts } from "./fuel-products"
import { fuelStorageLocations } from "./fuel-cycle"

/** Lotes de importación del control manual TAE. */
export const fuelTaeImportBatches = pgTable("fuel_tae_import_batches", {
  id:             text("id").primaryKey(),
  fileName:       text("file_name").notNull(),
  filePath:       text("file_path"),
  fileHash:       text("file_hash").notNull(),
  status:         text("status").notNull().default("imported"),
  totalRows:      integer("total_rows").notNull().default(0),
  validRows:      integer("valid_rows").notNull().default(0),
  observedRows:   integer("observed_rows").notNull().default(0),
  invalidRows:    integer("invalid_rows").notNull().default(0),
  totalLiters:    numeric("total_liters", { precision: 14, scale: 4, mode: "number" }).notNull().default(0),
  importedBy:     text("imported_by").notNull().references(() => users.id),
  notes:          text("notes"),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_tae_import_batches_status_valid", sql`${table.status} IN ('imported', 'reverted')`),
  index("fuel_tae_import_batches_hash_idx").on(table.fileHash),
  index("fuel_tae_import_batches_status_idx").on(table.status),
])

/** Punto físico desde donde se controla/carga combustible TAE. */
export const fuelTaeLoadingPoints = pgTable("fuel_tae_loading_points", {
  id:           text("id").primaryKey(),
  worksiteId:   text("worksite_id").notNull().references(() => worksites.id),
  /** Vasija física de la que reparte este punto. Opcional: puntos legados de
   *  importación histórica ("tae" genérico) pueden no corresponder a una vasija
   *  administrada. Sin este enlace, lo que la PWA entrega no se puede atribuir
   *  al saldo de una vasija concreta. */
  storageLocationId: text("storage_location_id").references(() => fuelStorageLocations.id, { onDelete: "set null" }),
  name:         text("name").notNull(),
  type:         text("type").notNull().default("other"),
  importAliases: jsonb("import_aliases").notNull().default([]),
  isActive:     boolean("is_active").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_tae_loading_points_type_valid", sql`${table.type} IN ('fixed_dispenser', 'truck_dispenser', 'pickup_tank', 'tae', 'other')`),
  uniqueIndex("fuel_tae_loading_points_worksite_name_unique").on(table.worksiteId, table.name),
  index("fuel_tae_loading_points_worksite_idx").on(table.worksiteId),
])

/** Enlace QR público, revocable y delimitado por faena/punto. */
export const fuelTaePublicLinks = pgTable("fuel_tae_public_links", {
  id:             text("id").primaryKey(),
  worksiteId:     text("worksite_id").notNull().references(() => worksites.id),
  loadingPointId: text("loading_point_id").references(() => fuelTaeLoadingPoints.id),
  label:          text("label").notNull(),
  tokenHash:      text("token_hash").notNull().unique(),
  expiresAt:      timestamp("expires_at", { withTimezone: true, mode: "string" }),
  revokedAt:      timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  lastUsedAt:     timestamp("last_used_at", { withTimezone: true, mode: "string" }),
  createdBy:      text("created_by").notNull().references(() => users.id),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("fuel_tae_public_links_worksite_idx").on(table.worksiteId),
  index("fuel_tae_public_links_loading_point_idx").on(table.loadingPointId),
])

/** Una carga TAE confirmada por la PWA pública o importada desde el histórico. */
export const fuelTaeSubmissions = pgTable("fuel_tae_submissions", {
  id:                    text("id").primaryKey(),
  clientSubmissionId:    text("client_submission_id").notNull().unique(),
  importBatchId:         text("import_batch_id").references(() => fuelTaeImportBatches.id, { onDelete: "set null" }),
  source:                text("source").notNull().default("public_pwa"),
  legacySourceId:        text("legacy_source_id"),
  publicResultToken:     text("public_result_token").notNull().unique(),
  publicResultRevokedAt: timestamp("public_result_revoked_at", { withTimezone: true, mode: "string" }),
  worksiteId:            text("worksite_id").notNull().references(() => worksites.id),
  loadingPointId:        text("loading_point_id").references(() => fuelTaeLoadingPoints.id),
  vehicleId:             text("vehicle_id").references(() => fuelVehicles.id),
  productId:             text("product_id").notNull().references(() => fuelProducts.id),
  equipmentCodeSnapshot: text("equipment_code_snapshot").notNull(),
  plateSnapshot:         text("plate_snapshot"),
  loadedAt:              timestamp("loaded_at", { withTimezone: true, mode: "string" }).notNull(),
  submittedAt:           timestamp("submitted_at", { withTimezone: true, mode: "string" }).notNull(),
  driverWorkerId:        text("driver_worker_id").references(() => workers.id),
  driverNameSnapshot:    text("driver_name_snapshot").notNull(),
  supervisorWorkerId:    text("supervisor_worker_id").references(() => workers.id),
  supervisorNameSnapshot:text("supervisor_name_snapshot").notNull(),
  manualIdentity:        boolean("manual_identity").notNull().default(false),
  meterType:             text("meter_type").notNull(),
  meterReading:          numeric("meter_reading", { precision: 14, scale: 2, mode: "number" }),
  meterReadingSource:    text("meter_reading_source"),
  /** Resultado OCR conservado como sugerencia; nunca sustituye una lectura humana de baja confianza. */
  ocrSuggestedReading:   numeric("ocr_suggested_reading", { precision: 14, scale: 2, mode: "number" }),
  ocrConfidence:         numeric("ocr_confidence", { precision: 5, scale: 4, mode: "number" }),
  ocrRawText:            text("ocr_raw_text"),
  ocrProcessedAt:        timestamp("ocr_processed_at", { withTimezone: true, mode: "string" }),
  meterUnavailableReason:text("meter_unavailable_reason"),
  liters:                numeric("liters", { precision: 12, scale: 4, mode: "number" }).notNull(),
  removedSealNumber:     text("removed_seal_number"),
  installedSealNumber:   text("installed_seal_number"),
  noSealReason:          text("no_seal_reason"),
  notes:                 text("notes"),
  status:                text("status").notNull().default("submitted"),
  reviewNote:            text("review_note"),
  reviewedBy:            text("reviewed_by").references(() => users.id),
  reviewedAt:            timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  rawRow:                jsonb("raw_row"),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_tae_submissions_source_valid", sql`${table.source} IN ('public_pwa', 'legacy_xlsx')`),
  check("fuel_tae_submissions_meter_type_valid", sql`${table.meterType} IN ('odometer', 'hour_meter')`),
  check("fuel_tae_submissions_meter_reading_source_valid", sql`${table.meterReadingSource} IN ('ocr', 'manual', 'import')`),
  check("fuel_tae_submissions_liters_positive", sql`${table.liters} > 0`),
  check("fuel_tae_submissions_status_valid", sql`${table.status} IN ('submitted', 'observed', 'validated', 'voided')`),
  index("fuel_tae_submissions_worksite_loaded_idx").on(table.worksiteId, table.loadedAt),
  index("fuel_tae_submissions_vehicle_loaded_idx").on(table.vehicleId, table.loadedAt),
  index("fuel_tae_submissions_product_loaded_idx").on(table.productId, table.loadedAt),
  index("fuel_tae_submissions_loading_point_idx").on(table.loadingPointId),
  index("fuel_tae_submissions_status_idx").on(table.status),
  index("fuel_tae_submissions_import_batch_idx").on(table.importBatchId),
  index("fuel_tae_submissions_installed_seal_idx").on(table.installedSealNumber),
  uniqueIndex("fuel_tae_submissions_legacy_source_unique")
    .on(table.importBatchId, table.legacySourceId)
    .where(sql`${table.legacySourceId} IS NOT NULL`),
])

/** Decisión manual: qué equipo del catálogo corresponde a un código histórico
 *  ambiguo en una faena. `vehicle_id` nulo significa "revisado, sin equivalente"
 *  — evita volver a marcar como ambiguo un código ya descartado a propósito.
 *  Se consulta ANTES del fuzzy-match en `buildTaeImportPlan`, así una decisión
 *  se aplica sola en cualquier reimportación futura del mismo histórico. */
export const fuelTaeVehicleMappings = pgTable("fuel_tae_vehicle_mappings", {
  id:          text("id").primaryKey(),
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  legacyCode:  text("legacy_code").notNull(),
  vehicleId:   text("vehicle_id").references(() => fuelVehicles.id, { onDelete: "set null" }),
  decidedBy:   text("decided_by").notNull().references(() => users.id),
  decidedAt:   timestamp("decided_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  notes:       text("notes"),
}, (table) => [
  uniqueIndex("fuel_tae_vehicle_mappings_worksite_code_unique").on(table.worksiteId, table.legacyCode),
])

/** Igual que `fuelTaeVehicleMappings` pero para conductor/supervisor, que comparten
 *  el catálogo de `workers` y se distinguen por `role`. */
export const fuelTaeWorkerMappings = pgTable("fuel_tae_worker_mappings", {
  id:          text("id").primaryKey(),
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  role:        text("role").notNull(),
  legacyName:  text("legacy_name").notNull(),
  workerId:    text("worker_id").references(() => workers.id, { onDelete: "set null" }),
  decidedBy:   text("decided_by").notNull().references(() => users.id),
  decidedAt:   timestamp("decided_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  notes:       text("notes"),
}, (table) => [
  check("fuel_tae_worker_mappings_role_valid", sql`${table.role} IN ('driver', 'supervisor')`),
  uniqueIndex("fuel_tae_worker_mappings_worksite_role_name_unique").on(table.worksiteId, table.role, table.legacyName),
])

/** Fila descartada de un lote histórico: falla de formato al parsear, o falla al
 *  resolver la faena. Antes de esto sólo se contaban (`invalid_rows`); persistirlas
 *  permite mostrar el detalle y, más adelante, reprocesarlas. */
export const fuelTaeImportRejections = pgTable("fuel_tae_import_rejections", {
  id:             text("id").primaryKey(),
  batchId:        text("batch_id").notNull().references(() => fuelTaeImportBatches.id, { onDelete: "cascade" }),
  rowIndex:       integer("row_index").notNull(),
  stage:          text("stage").notNull(),
  field:          text("field"),
  message:        text("message").notNull(),
  legacySourceId: text("legacy_source_id"),
  rawRow:         jsonb("raw_row"),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_tae_import_rejections_stage_valid", sql`${table.stage} IN ('parse', 'worksite')`),
  index("fuel_tae_import_rejections_batch_idx").on(table.batchId),
])

/** Evidencia fotográfica de la carga, siempre privada. */
export const fuelTaeEvidence = pgTable("fuel_tae_evidence", {
  id:           text("id").primaryKey(),
  submissionId: text("submission_id").notNull().references(() => fuelTaeSubmissions.id, { onDelete: "cascade" }),
  kind:         text("kind").notNull(),
  fileName:     text("file_name").notNull(),
  filePath:     text("file_path"),
  fileSize:     integer("file_size"),
  mimeType:     text("mime_type"),
  sha256:       text("sha256"),
  externalUrl:  text("external_url"),
  capturedAt:   timestamp("captured_at", { withTimezone: true, mode: "string" }),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_tae_evidence_kind_valid", sql`${table.kind} IN ('odometer', 'liter_meter', 'removed_seal', 'installed_seal')`),
  uniqueIndex("fuel_tae_evidence_submission_kind_unique").on(table.submissionId, table.kind),
  index("fuel_tae_evidence_submission_idx").on(table.submissionId),
])

export const fuelTaeImportBatchesRelations = relations(fuelTaeImportBatches, ({ one, many }) => ({
  importer: one(users, { fields: [fuelTaeImportBatches.importedBy], references: [users.id] }),
  submissions: many(fuelTaeSubmissions),
  rejections: many(fuelTaeImportRejections),
}))

export const fuelTaeImportRejectionsRelations = relations(fuelTaeImportRejections, ({ one }) => ({
  batch: one(fuelTaeImportBatches, { fields: [fuelTaeImportRejections.batchId], references: [fuelTaeImportBatches.id] }),
}))

export const fuelTaeVehicleMappingsRelations = relations(fuelTaeVehicleMappings, ({ one }) => ({
  worksite: one(worksites, { fields: [fuelTaeVehicleMappings.worksiteId], references: [worksites.id] }),
  vehicle: one(fuelVehicles, { fields: [fuelTaeVehicleMappings.vehicleId], references: [fuelVehicles.id] }),
  decider: one(users, { fields: [fuelTaeVehicleMappings.decidedBy], references: [users.id] }),
}))

export const fuelTaeWorkerMappingsRelations = relations(fuelTaeWorkerMappings, ({ one }) => ({
  worksite: one(worksites, { fields: [fuelTaeWorkerMappings.worksiteId], references: [worksites.id] }),
  worker: one(workers, { fields: [fuelTaeWorkerMappings.workerId], references: [workers.id] }),
  decider: one(users, { fields: [fuelTaeWorkerMappings.decidedBy], references: [users.id] }),
}))

export const fuelTaeLoadingPointsRelations = relations(fuelTaeLoadingPoints, ({ one, many }) => ({
  worksite: one(worksites, { fields: [fuelTaeLoadingPoints.worksiteId], references: [worksites.id] }),
  storageLocation: one(fuelStorageLocations, { fields: [fuelTaeLoadingPoints.storageLocationId], references: [fuelStorageLocations.id] }),
  publicLinks: many(fuelTaePublicLinks),
  submissions: many(fuelTaeSubmissions),
}))

export const fuelTaePublicLinksRelations = relations(fuelTaePublicLinks, ({ one }) => ({
  worksite: one(worksites, { fields: [fuelTaePublicLinks.worksiteId], references: [worksites.id] }),
  loadingPoint: one(fuelTaeLoadingPoints, { fields: [fuelTaePublicLinks.loadingPointId], references: [fuelTaeLoadingPoints.id] }),
  creator: one(users, { fields: [fuelTaePublicLinks.createdBy], references: [users.id] }),
}))

/* ── Fuel Seal Movements (historial de cambios de sello, sección 9) ──────── */

export const fuelSealMovements = pgTable("fuel_seal_movements", {
  id:              text("id").primaryKey(),
  submissionId:    text("submission_id").notNull().references(() => fuelTaeSubmissions.id),
  sealNumber:      text("seal_number").notNull(),
  movementType:    text("movement_type").notNull(),           // "removed" | "installed"
  changedBy:       text("changed_by").references(() => users.id),
  justification:   text("justification"),
  isException:     boolean("is_exception").notNull().default(false),
  evidenceFileName: text("evidence_file_name"),
  evidenceFilePath: text("evidence_file_path"),
  evidenceSha256:  text("evidence_sha256"),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_seal_movements_type_valid", sql`${table.movementType} IN ('removed', 'installed')`),
  index("fuel_seal_movements_submission_idx").on(table.submissionId),
  index("fuel_seal_movements_seal_number_idx").on(table.sealNumber),
  index("fuel_seal_movements_type_idx").on(table.movementType),
])

export const fuelSealMovementsRelations = relations(fuelSealMovements, ({ one }) => ({
  submission: one(fuelTaeSubmissions, { fields: [fuelSealMovements.submissionId], references: [fuelTaeSubmissions.id] }),
  changer: one(users, { fields: [fuelSealMovements.changedBy], references: [users.id] }),
}))

export const fuelTaeSubmissionsRelations = relations(fuelTaeSubmissions, ({ one, many }) => ({
  importBatch: one(fuelTaeImportBatches, { fields: [fuelTaeSubmissions.importBatchId], references: [fuelTaeImportBatches.id] }),
  worksite: one(worksites, { fields: [fuelTaeSubmissions.worksiteId], references: [worksites.id] }),
  loadingPoint: one(fuelTaeLoadingPoints, { fields: [fuelTaeSubmissions.loadingPointId], references: [fuelTaeLoadingPoints.id] }),
  vehicle: one(fuelVehicles, { fields: [fuelTaeSubmissions.vehicleId], references: [fuelVehicles.id] }),
  product: one(fuelProducts, { fields: [fuelTaeSubmissions.productId], references: [fuelProducts.id] }),
  driver: one(workers, { relationName: "fuel_tae_driver", fields: [fuelTaeSubmissions.driverWorkerId], references: [workers.id] }),
  supervisor: one(workers, { relationName: "fuel_tae_supervisor", fields: [fuelTaeSubmissions.supervisorWorkerId], references: [workers.id] }),
  reviewer: one(users, { fields: [fuelTaeSubmissions.reviewedBy], references: [users.id] }),
  evidence: many(fuelTaeEvidence),
}))

export const fuelTaeEvidenceRelations = relations(fuelTaeEvidence, ({ one }) => ({
  submission: one(fuelTaeSubmissions, { fields: [fuelTaeEvidence.submissionId], references: [fuelTaeSubmissions.id] }),
}))

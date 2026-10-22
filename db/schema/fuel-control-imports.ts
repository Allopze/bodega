import { relations, sql } from "drizzle-orm"
import { check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"
import { fuelVehicles } from "./fuel-vehicles"
import { fuelSupplyMedia } from "./fuel-control"

/**
 * Lote de un importador del submódulo de control (telemetría o entradas de
 * suministro). Reimportar el mismo archivo no duplica: el hash bloquea el lote
 * y cada fila tiene su llave natural única.
 */
export const fuelControlImportBatches = pgTable("fuel_control_import_batches", {
  id:           text("id").primaryKey(),
  kind:         text("kind").notNull(),
  fileName:     text("file_name").notNull(),
  fileHash:     text("file_hash").notNull(),
  status:       text("status").notNull().default("imported"),
  totalRows:    integer("total_rows").notNull().default(0),
  insertedRows: integer("inserted_rows").notNull().default(0),
  updatedRows:  integer("updated_rows").notNull().default(0),
  rejectedRows: integer("rejected_rows").notNull().default(0),
  importedBy:   text("imported_by").notNull().references(() => users.id),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [
  check("fuel_control_import_batches_kind_valid", sql`${t.kind} IN ('telemetry', 'supply_inputs')`),
  check("fuel_control_import_batches_status_valid", sql`${t.status} IN ('imported', 'reverted')`),
  index("fuel_control_import_batches_hash_idx").on(t.kind, t.fileHash),
])

/**
 * Fila que no se pudo convertir en registro, con su motivo. Común a los
 * importadores del submódulo y al log operacional, que antes solo contaba los
 * rechazos (`fuel_operation_batches.filas_invalidas`).
 */
export const fuelControlImportRejections = pgTable("fuel_control_import_rejections", {
  id:        text("id").primaryKey(),
  batchKind: text("batch_kind").notNull(),
  batchId:   text("batch_id").notNull(),
  rowIndex:  integer("row_index").notNull(),
  field:     text("field"),
  message:   text("message").notNull(),
  rawRow:    jsonb("raw_row"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [
  check("fuel_control_import_rejections_kind_valid", sql`${t.batchKind} IN ('telemetry', 'supply_inputs', 'operations')`),
  index("fuel_control_import_rejections_batch_idx").on(t.batchKind, t.batchId),
])

/** Litros que un medio informa haber entregado (surtidor del mandante, tarjeta sin integración). */
export const fuelSupplyInputs = pgTable("fuel_supply_inputs", {
  id:             text("id").primaryKey(),
  batchId:        text("batch_id").references(() => fuelControlImportBatches.id, { onDelete: "cascade" }),
  supplyMediumId: text("supply_medium_id").notNull().references(() => fuelSupplyMedia.id),
  worksiteId:     text("worksite_id").notNull().references(() => worksites.id),
  vehicleId:      text("vehicle_id").references(() => fuelVehicles.id),
  occurredAt:     timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  month:          text("month").notNull(),
  liters:         numeric("liters", { precision: 12, scale: 4, mode: "number" }).notNull(),
  /** Guía o folio del medio: junto con el medio, la llave de idempotencia. */
  reference:      text("reference").notNull(),
  rawRow:         jsonb("raw_row"),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [
  check("fuel_supply_inputs_liters_positive", sql`${t.liters} > 0`),
  check("fuel_supply_inputs_month_format", sql`${t.month} ~ '^[0-9]{4}-[0-9]{2}$'`),
  uniqueIndex("fuel_supply_inputs_reference_unique").on(t.supplyMediumId, t.reference),
  index("fuel_supply_inputs_worksite_time_idx").on(t.worksiteId, t.occurredAt),
  index("fuel_supply_inputs_medium_time_idx").on(t.supplyMediumId, t.occurredAt),
])

/** Telemetría diaria por equipo (VisionLink u otra). Ralentí y litros vienen de la fuente. */
export const fuelTelemetryDaily = pgTable("fuel_telemetry_daily", {
  id:             text("id").primaryKey(),
  batchId:        text("batch_id").references(() => fuelControlImportBatches.id, { onDelete: "cascade" }),
  vehicleId:      text("vehicle_id").notNull().references(() => fuelVehicles.id),
  source:         text("source").notNull(),
  day:            text("day").notNull(),
  month:          text("month").notNull(),
  operatingHours: numeric("operating_hours", { precision: 8, scale: 2, mode: "number" }).notNull(),
  idleHours:      numeric("idle_hours", { precision: 8, scale: 2, mode: "number" }).notNull(),
  litersWorking:  numeric("liters_working", { precision: 12, scale: 4, mode: "number" }),
  litersIdle:     numeric("liters_idle", { precision: 12, scale: 4, mode: "number" }),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [
  check("fuel_telemetry_daily_day_format", sql`${t.day} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  check("fuel_telemetry_daily_hours_valid", sql`${t.operatingHours} >= 0 AND ${t.operatingHours} <= 24 AND ${t.idleHours} >= 0 AND ${t.idleHours} <= ${t.operatingHours}`),
  check("fuel_telemetry_daily_liters_valid", sql`(${t.litersWorking} IS NULL OR ${t.litersWorking} >= 0) AND (${t.litersIdle} IS NULL OR ${t.litersIdle} >= 0)`),
  uniqueIndex("fuel_telemetry_daily_vehicle_day_source_unique").on(t.vehicleId, t.day, t.source),
  index("fuel_telemetry_daily_month_idx").on(t.month),
])

export const fuelControlImportBatchesRelations = relations(fuelControlImportBatches, ({ one, many }) => ({
  importer: one(users, { fields: [fuelControlImportBatches.importedBy], references: [users.id] }),
  supplyInputs: many(fuelSupplyInputs),
  telemetry: many(fuelTelemetryDaily),
}))

export const fuelSupplyInputsRelations = relations(fuelSupplyInputs, ({ one }) => ({
  batch: one(fuelControlImportBatches, { fields: [fuelSupplyInputs.batchId], references: [fuelControlImportBatches.id] }),
  supplyMedium: one(fuelSupplyMedia, { fields: [fuelSupplyInputs.supplyMediumId], references: [fuelSupplyMedia.id] }),
  worksite: one(worksites, { fields: [fuelSupplyInputs.worksiteId], references: [worksites.id] }),
  vehicle: one(fuelVehicles, { fields: [fuelSupplyInputs.vehicleId], references: [fuelVehicles.id] }),
}))

export const fuelTelemetryDailyRelations = relations(fuelTelemetryDaily, ({ one }) => ({
  batch: one(fuelControlImportBatches, { fields: [fuelTelemetryDaily.batchId], references: [fuelControlImportBatches.id] }),
  vehicle: one(fuelVehicles, { fields: [fuelTelemetryDaily.vehicleId], references: [fuelVehicles.id] }),
}))

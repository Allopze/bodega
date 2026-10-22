import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites, workers } from "./worksites"
import { clients } from "./clients"
import { fuelVehicles } from "./fuel-vehicles"
import { fuelSuppliers } from "./fuel-suppliers"
import { fuelOperationRecords } from "./fuel-operations"
import { fuelTaeSubmissions } from "./fuel-tae"

/**
 * Submódulo de control de combustible (reemplazo del tablero de Looker Studio).
 * Ver GAP_MODULO_COMBUSTIBLE.md §3 y §6 para el porqué de cada tabla.
 */

/** Mandante: agrupa faenas para conciliar entradas y entregas con una tolerancia propia. */
export const fuelMandantes = pgTable("fuel_mandantes", {
  id:           text("id").primaryKey(),
  name:         text("name").notNull(),
  /** Cliente comercial, si existe en facturación. Evita duplicar el cliente. */
  clientId:     text("client_id").references(() => clients.id, { onDelete: "set null" }),
  /** Diferencia de conciliación tolerada, en % de la entrada. */
  tolerancePct: numeric("tolerance_pct", { precision: 6, scale: 2, mode: "number" }).notNull().default(2),
  isActive:     boolean("is_active").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("fuel_mandantes_name_unique").on(t.name),
  check("fuel_mandantes_tolerance_valid", sql`${t.tolerancePct} >= 0 AND ${t.tolerancePct} <= 100`),
])

/** Una faena pertenece a lo más a un mandante de control. */
export const fuelMandanteWorksites = pgTable("fuel_mandante_worksites", {
  worksiteId: text("worksite_id").primaryKey().references(() => worksites.id, { onDelete: "cascade" }),
  mandanteId: text("mandante_id").notNull().references(() => fuelMandantes.id, { onDelete: "cascade" }),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [
  index("fuel_mandante_worksites_mandante_idx").on(t.mandanteId),
])

/** Medio de suministro (TCT, TAE, surtidor CMPC, Aramco, Copec…). */
export const fuelSupplyMedia = pgTable("fuel_supply_media", {
  id:              text("id").primaryKey(),
  slug:            text("slug").notNull(),
  name:            text("name").notNull(),
  kind:            text("kind").notNull().default("other"),
  fuelSupplierId:  text("fuel_supplier_id").references(() => fuelSuppliers.id, { onDelete: "set null" }),
  /** Lectura del libro `fuel_provider_transactions`: proveedor y canal que equivalen a este medio. */
  providerCode:    text("provider_code"),
  providerChannel: text("provider_channel"),
  /** Textos con que aparece en planillas («Suministro entregado por»), en mayúsculas. */
  aliases:         jsonb("aliases").$type<string[]>().notNull().default([]),
  sortOrder:       integer("sort_order").notNull().default(0),
  isActive:        boolean("is_active").notNull().default(true),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("fuel_supply_media_slug_unique").on(t.slug),
  check("fuel_supply_media_kind_valid", sql`${t.kind} IN ('card', 'provider_station', 'mandante_dispenser', 'own_tank', 'other')`),
  check("fuel_supply_media_provider_valid", sql`${t.providerCode} IS NULL OR ${t.providerCode} IN ('copec', 'aramco')`),
  check("fuel_supply_media_channel_valid", sql`${t.providerChannel} IS NULL OR ${t.providerChannel} IN ('TCT', 'TAE')`),
])

/**
 * Carga de combustible a un equipo: la serie canónica de la que salen el
 * rendimiento, las vistas G/R y la cola de revisión. Es una PROYECCIÓN
 * idempotente de sus orígenes (log operacional y cargas en terreno), nunca se
 * digita directo. El rendimiento lo calcula el servidor; `declaredPerformance`
 * guarda lo que traía la planilla solo para contrastar.
 */
export const fuelEquipmentLoads = pgTable("fuel_equipment_loads", {
  id:                    text("id").primaryKey(),
  source:                text("source").notNull(),
  operationRecordId:     text("operation_record_id").references(() => fuelOperationRecords.id, { onDelete: "cascade" }),
  taeSubmissionId:       text("tae_submission_id").references(() => fuelTaeSubmissions.id, { onDelete: "cascade" }),
  vehicleId:             text("vehicle_id").references(() => fuelVehicles.id),
  worksiteId:            text("worksite_id").notNull().references(() => worksites.id),
  supplyMediumId:        text("supply_medium_id").references(() => fuelSupplyMedia.id, { onDelete: "set null" }),
  loadingPointType:      text("loading_point_type"),
  occurredAt:            timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  /** "YYYY-MM" en hora de Chile, para agrupar sin convertir zona en cada consulta. */
  month:                 text("month").notNull(),
  liters:                numeric("liters", { precision: 12, scale: 4, mode: "number" }).notNull(),
  meterType:             text("meter_type"),
  meterReading:          numeric("meter_reading", { precision: 14, scale: 2, mode: "number" }),
  /** Corrección explícita (cambio de tablero o de equipo): esta lectura inicia una serie nueva. */
  meterReset:            boolean("meter_reset").notNull().default(false),
  driverWorkerId:        text("driver_worker_id").references(() => workers.id, { onDelete: "set null" }),
  driverName:            text("driver_name"),
  supervisorWorkerId:    text("supervisor_worker_id").references(() => workers.id, { onDelete: "set null" }),
  supervisorName:        text("supervisor_name"),
  // ── calculado por el servidor ──
  anchorLoadId:          text("anchor_load_id").references((): AnyPgColumn => fuelEquipmentLoads.id, { onDelete: "set null" }),
  meterDelta:            numeric("meter_delta", { precision: 14, scale: 2, mode: "number" }),
  accumulatedLiters:     numeric("accumulated_liters", { precision: 14, scale: 4, mode: "number" }),
  performanceUnit:       text("performance_unit"),
  performanceValue:      numeric("performance_value", { precision: 12, scale: 4, mode: "number" }),
  performanceStatus:     text("performance_status").notNull().default("not_applicable"),
  declaredPerformance:   numeric("declared_performance", { precision: 12, scale: 4, mode: "number" }),
  // ── revisión ──
  reviewStatus:          text("review_status").notNull().default("ok"),
  flagReasons:           jsonb("flag_reasons").$type<string[]>().notNull().default([]),
  reviewNote:            text("review_note"),
  reviewedBy:            text("reviewed_by").references(() => users.id),
  reviewedAt:            timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  duplicateOfId:         text("duplicate_of_id").references((): AnyPgColumn => fuelEquipmentLoads.id, { onDelete: "set null" }),
  voidedAt:              timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidReason:            text("void_reason"),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [
  check("fuel_equipment_loads_source_valid", sql`${t.source} IN ('operations_import', 'field', 'legacy_tae')`),
  check("fuel_equipment_loads_source_shape", sql`
    (${t.source} = 'operations_import' AND ${t.operationRecordId} IS NOT NULL AND ${t.taeSubmissionId} IS NULL)
    OR (${t.source} IN ('field', 'legacy_tae') AND ${t.taeSubmissionId} IS NOT NULL AND ${t.operationRecordId} IS NULL)
  `),
  check("fuel_equipment_loads_liters_positive", sql`${t.liters} > 0`),
  check("fuel_equipment_loads_meter_type_valid", sql`${t.meterType} IS NULL OR ${t.meterType} IN ('odometer', 'hour_meter')`),
  check("fuel_equipment_loads_unit_valid", sql`${t.performanceUnit} IS NULL OR ${t.performanceUnit} IN ('km_per_liter', 'liters_per_hour')`),
  check("fuel_equipment_loads_perf_status_valid", sql`${t.performanceStatus} IN ('computed', 'first_load', 'no_meter', 'meter_regression', 'meter_reset', 'zero_delta', 'not_applicable', 'excluded')`),
  check("fuel_equipment_loads_review_valid", sql`${t.reviewStatus} IN ('ok', 'flagged', 'approved', 'rejected')`),
  check("fuel_equipment_loads_month_format", sql`${t.month} ~ '^[0-9]{4}-[0-9]{2}$'`),
  uniqueIndex("fuel_equipment_loads_operation_record_unique").on(t.operationRecordId).where(sql`${t.operationRecordId} IS NOT NULL`),
  uniqueIndex("fuel_equipment_loads_tae_submission_unique").on(t.taeSubmissionId).where(sql`${t.taeSubmissionId} IS NOT NULL`),
  index("fuel_equipment_loads_vehicle_time_idx").on(t.vehicleId, t.occurredAt),
  index("fuel_equipment_loads_worksite_time_idx").on(t.worksiteId, t.occurredAt),
  index("fuel_equipment_loads_medium_time_idx").on(t.supplyMediumId, t.occurredAt),
  index("fuel_equipment_loads_month_idx").on(t.month),
  index("fuel_equipment_loads_review_idx").on(t.reviewStatus),
])

export const fuelMandantesRelations = relations(fuelMandantes, ({ one, many }) => ({
  client: one(clients, { fields: [fuelMandantes.clientId], references: [clients.id] }),
  worksites: many(fuelMandanteWorksites),
}))

export const fuelMandanteWorksitesRelations = relations(fuelMandanteWorksites, ({ one }) => ({
  mandante: one(fuelMandantes, { fields: [fuelMandanteWorksites.mandanteId], references: [fuelMandantes.id] }),
  worksite: one(worksites, { fields: [fuelMandanteWorksites.worksiteId], references: [worksites.id] }),
}))

export const fuelSupplyMediaRelations = relations(fuelSupplyMedia, ({ one }) => ({
  fuelSupplier: one(fuelSuppliers, { fields: [fuelSupplyMedia.fuelSupplierId], references: [fuelSuppliers.id] }),
}))

export const fuelEquipmentLoadsRelations = relations(fuelEquipmentLoads, ({ one }) => ({
  vehicle: one(fuelVehicles, { fields: [fuelEquipmentLoads.vehicleId], references: [fuelVehicles.id] }),
  worksite: one(worksites, { fields: [fuelEquipmentLoads.worksiteId], references: [worksites.id] }),
  supplyMedium: one(fuelSupplyMedia, { fields: [fuelEquipmentLoads.supplyMediumId], references: [fuelSupplyMedia.id] }),
  operationRecord: one(fuelOperationRecords, { fields: [fuelEquipmentLoads.operationRecordId], references: [fuelOperationRecords.id] }),
  taeSubmission: one(fuelTaeSubmissions, { fields: [fuelEquipmentLoads.taeSubmissionId], references: [fuelTaeSubmissions.id] }),
  reviewer: one(users, { fields: [fuelEquipmentLoads.reviewedBy], references: [users.id] }),
}))

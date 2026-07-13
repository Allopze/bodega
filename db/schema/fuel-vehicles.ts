import { pgTable, text, integer, boolean, timestamp, index, numeric, jsonb, check, uniqueIndex } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { worksites } from "./worksites"
import { fuelLoads } from "./fuel-invoices"
import { users } from "./users"
import { fuelSuppliers } from "./fuel-suppliers"
import { fuelEquipmentTypes } from "./fuel-equipment-types"

/* ── Fuel Vehicles (catálogo propio del módulo combustibles) ─────────────── */
export const fuelVehicles = pgTable("fuel_vehicles", {
  id:        text("id").primaryKey(),
  plate:     text("plate").notNull().unique(),       // Patente
  code:      text("code"),                            // Código interno de equipo (ej. KA-63)
  type:      text("type").notNull(),                  // Snapshot legacy; la fuente canónica es equipmentTypeId.
  equipmentTypeId: text("equipment_type_id").notNull().references(() => fuelEquipmentTypes.id),
  meterType: text("meter_type").notNull().default("none"),
  performanceUnit: text("performance_unit").notNull().default("not_applicable"),
  tankCapacityLiters: numeric("tank_capacity_liters", { precision: 12, scale: 2, mode: "number" }),
  comparisonGroup: text("comparison_group"),
  usualFuelSupplierId: text("usual_fuel_supplier_id").references(() => fuelSuppliers.id),
  operatingSchedule: jsonb("operating_schedule").$type<{ timezone: string; days: number[]; start: string; end: string } | null>(),
  brand:     text("brand"),                           // Marca
  model:     text("model"),                           // Modelo
  year:      integer("year"),                         // Año
  worksiteId: text("worksite_id").notNull().references(() => worksites.id),  // Faena asignada
  responsibleUserId: text("responsible_user_id").references(() => users.id),
  operationalStatus: text("operational_status").notNull().default("operativo"),
  soapExpiresAt: text("soap_expires_at"),
  technicalReviewExpiresAt: text("technical_review_expires_at"),
  circulationPermitExpiresAt: text("circulation_permit_expires_at"),
  insurancePolicyNumber: text("insurance_policy_number"),
  insuranceExpiresAt: text("insurance_expires_at"),
  isActive:  boolean("is_active").notNull().default(true),
  notes:     text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("fuel_vehicles_worksite_idx").on(table.worksiteId),
  index("fuel_vehicles_responsible_idx").on(table.responsibleUserId),
  index("fuel_vehicles_status_idx").on(table.operationalStatus),
  index("fuel_vehicles_type_idx").on(table.type),
  index("fuel_vehicles_equipment_type_idx").on(table.equipmentTypeId),
  index("fuel_vehicles_performance_unit_idx").on(table.performanceUnit),
  index("fuel_vehicles_usual_supplier_idx").on(table.usualFuelSupplierId),
  index("fuel_vehicles_code_idx").on(table.code),
  check("fuel_vehicles_meter_type_valid", sql`${table.meterType} IN ('odometer', 'hour_meter', 'none')`),
  check("fuel_vehicles_performance_unit_valid", sql`${table.performanceUnit} IN ('km_per_liter', 'liters_per_hour', 'not_applicable')`),
  check("fuel_vehicles_tank_capacity_positive", sql`${table.tankCapacityLiters} IS NULL OR ${table.tankCapacityLiters} > 0`),
])

export const fleetVehicleDocuments = pgTable("fleet_vehicle_documents", {
  id:           text("id").primaryKey(),
  vehicleId:    text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  fileName:     text("file_name").notNull(),
  filePath:     text("file_path").notNull(),
  fileSize:     integer("file_size"),
  mimeType:     text("mime_type"),
  expiresAt:    text("expires_at"),
  uploadedBy:   text("uploaded_by").notNull().references(() => users.id),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("fleet_vehicle_documents_vehicle_idx").on(table.vehicleId),
  index("fleet_vehicle_documents_expires_idx").on(table.expiresAt),
])

/** Historial continuo del estado operacional de un equipo. Sólo puede existir un intervalo abierto por vehículo. */
export const fuelVehicleOperationalIntervals = pgTable("fuel_vehicle_operational_intervals", {
  id:        text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "cascade" }),
  status:    text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
  endedAt:   timestamp("ended_at", { withTimezone: true, mode: "string" }),
  reason:    text("reason"),
  changedBy: text("changed_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_vehicle_operational_intervals_status_valid", sql`${table.status} IN ('operativo', 'mantencion', 'fuera_servicio')`),
  check("fuel_vehicle_operational_intervals_dates_valid", sql`${table.endedAt} IS NULL OR ${table.endedAt} > ${table.startedAt}`),
  uniqueIndex("fuel_vehicle_operational_intervals_open_unique").on(table.vehicleId).where(sql`${table.endedAt} IS NULL`),
  index("fuel_vehicle_operational_intervals_vehicle_started_idx").on(table.vehicleId, table.startedAt),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const fuelVehiclesRelations = relations(fuelVehicles, ({ one, many }) => ({
  worksite: one(worksites, {
    fields: [fuelVehicles.worksiteId],
    references: [worksites.id],
  }),
  responsibleUser: one(users, {
    fields: [fuelVehicles.responsibleUserId],
    references: [users.id],
  }),
  equipmentType: one(fuelEquipmentTypes, {
    fields: [fuelVehicles.equipmentTypeId],
    references: [fuelEquipmentTypes.id],
  }),
  usualFuelSupplier: one(fuelSuppliers, {
    fields: [fuelVehicles.usualFuelSupplierId],
    references: [fuelSuppliers.id],
  }),
  loads: many(fuelLoads),
  documents: many(fleetVehicleDocuments),
  operationalIntervals: many(fuelVehicleOperationalIntervals),
}))

export const fuelEquipmentTypesRelations = relations(fuelEquipmentTypes, ({ many }) => ({
  vehicles: many(fuelVehicles),
}))

export const fleetVehicleDocumentsRelations = relations(fleetVehicleDocuments, ({ one }) => ({
  vehicle: one(fuelVehicles, {
    fields: [fleetVehicleDocuments.vehicleId],
    references: [fuelVehicles.id],
  }),
  uploader: one(users, {
    fields: [fleetVehicleDocuments.uploadedBy],
    references: [users.id],
  }),
}))

export const fuelVehicleOperationalIntervalsRelations = relations(fuelVehicleOperationalIntervals, ({ one }) => ({
  vehicle: one(fuelVehicles, {
    fields: [fuelVehicleOperationalIntervals.vehicleId],
    references: [fuelVehicles.id],
  }),
  changedByUser: one(users, {
    fields: [fuelVehicleOperationalIntervals.changedBy],
    references: [users.id],
  }),
}))

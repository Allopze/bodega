import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { fuelVehicles } from "./fuel-vehicles"
import { users } from "./users"
import { workers, worksites } from "./worksites"
import { mantSchedules } from "./mantencion-schedules"

/*
 * Módulo de mantención de equipos (preventiva y correctiva), 2026-10-28.
 *
 * Es un módulo **nuevo e independiente** del de `maintenance_*` (órdenes de
 * trabajo con costos), que no se toca. Todo lo suyo lleva el prefijo `mant_`.
 *
 * No duplica catálogos: el equipo es `fuel_vehicles` (la flota de la
 * plataforma) y la faena es `worksites`. Lo que este módulo necesita y esas
 * tablas no tienen vive en extensiones 1:1 (`mant_equipment_profiles`,
 * `mant_worksite_settings`), de modo que ningún otro módulo cambia de forma.
 */

/** Código de folio de cada faena: `MP-BIO-0001`. Tres letras, único. */
export const mantWorksiteSettings = pgTable("mant_worksite_settings", {
  worksiteId: text("worksite_id").primaryKey().references(() => worksites.id, { onDelete: "cascade" }),
  folioCode:  text("folio_code").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedBy:  text("updated_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  uniqueIndex("mant_worksite_settings_folio_code_unique").on(table.folioCode),
  check("mant_worksite_settings_folio_code_valid", sql`${table.folioCode} ~ '^[A-Z]{3}$'`),
])

/**
 * Catálogos cerrados. `name_key` es el nombre normalizado (minúsculas, sin
 * tildes ni espacios repetidos): «Cholguán» y «cholguan» son la misma fila.
 */
function catalogColumns() {
  return {
    id:        text("id").primaryKey(),
    name:      text("name").notNull(),
    nameKey:   text("name_key").notNull(),
    isActive:  boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  }
}

/** Marcas de equipo. Lista cerrada: una regla por marca nunca compara texto libre. */
export const mantBrands = pgTable("mant_brands", catalogColumns(), (table) => [
  uniqueIndex("mant_brands_name_key_unique").on(table.nameKey),
])

/** Talleres externos que pueden ejecutar una correctiva. */
export const mantWorkshops = pgTable("mant_workshops", catalogColumns(), (table) => [
  uniqueIndex("mant_workshops_name_key_unique").on(table.nameKey),
])

/** Tipos de trabajo de una correctiva (Mecánico, Soldadura…). */
export const mantWorkTypes = pgTable("mant_work_types", catalogColumns(), (table) => [
  uniqueIndex("mant_work_types_name_key_unique").on(table.nameKey),
])

/** Aceites que se pueden cambiar en una correctiva. */
export const mantOils = pgTable("mant_oils", catalogColumns(), (table) => [
  uniqueIndex("mant_oils_name_key_unique").on(table.nameKey),
])

/**
 * Conductores que el mecánico declara en una correctiva («conductores de las
 * últimas 24 h»). Se vinculan con la ficha de personal (`workers`) cuando el
 * nombre calza; la planilla de origen sólo trae «APELLIDO APELLIDO NOMBRE», sin
 * RUT, así que el vínculo es opcional y lo confirma una persona.
 */
export const mantDrivers = pgTable("mant_drivers", {
  ...catalogColumns(),
  workerId: text("worker_id").references(() => workers.id, { onDelete: "set null" }),
}, (table) => [
  uniqueIndex("mant_drivers_name_key_unique").on(table.nameKey),
  index("mant_drivers_worker_idx").on(table.workerId),
])

/**
 * Lo que la mantención necesita de un equipo de la flota y `fuel_vehicles` no
 * tiene. Un equipo entra al módulo cuando tiene esta fila.
 *
 * - La unidad (km/h) NO se guarda: se deriva del tipo
 *   (`fuel_equipment_types.default_meter_type`).
 * - La baja es `fuel_vehicles.is_active = false`; aquí sólo queda el motivo.
 * - `no_plate`: equipo sin patente; `fuel_vehicles.plate` guarda el código.
 */
export const mantEquipmentProfiles = pgTable("mant_equipment_profiles", {
  vehicleId:          text("vehicle_id").primaryKey().references(() => fuelVehicles.id, { onDelete: "restrict" }),
  brandId:            text("brand_id").notNull().references(() => mantBrands.id, { onDelete: "restrict" }),
  scheduleId:         text("schedule_id").references(() => mantSchedules.id, { onDelete: "set null" }),
  initialReading:     numeric("initial_reading", { precision: 14, scale: 1, mode: "number" }),
  initialReadingDate: text("initial_reading_date"),
  noPlate:            boolean("no_plate").notNull().default(false),
  retiredReason:      text("retired_reason"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedBy:          text("updated_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  index("mant_equipment_profiles_schedule_idx").on(table.scheduleId),
  index("mant_equipment_profiles_brand_idx").on(table.brandId),
  check("mant_equipment_profiles_initial_reading_valid", sql`${table.initialReading} IS NULL OR ${table.initialReading} >= 0`),
  check("mant_equipment_profiles_initial_reading_date", sql`(${table.initialReading} IS NULL) = (${table.initialReadingDate} IS NULL)`),
])

export const MANT_EQUIPMENT_HISTORY_ACTIONS = [
  "create", "update", "schedule_change", "retire", "reactivate", "import", "initial_reading",
] as const
export type MantEquipmentHistoryAction = (typeof MANT_EQUIPMENT_HISTORY_ACTIONS)[number]

/** Cambios por campo: `{ faena: { from: "Arauco", to: "Teno" } }`, con etiquetas legibles. */
export type MantFieldChanges = Record<string, { from: unknown; to: unknown }>

/** Historial de la ficha del equipo: quién cambió qué y cuándo. */
export const mantEquipmentHistory = pgTable("mant_equipment_history", {
  id:        text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "cascade" }),
  action:    text("action").notNull(),
  summary:   text("summary").notNull(),
  changes:   jsonb("changes").$type<MantFieldChanges>().notNull().default({}),
  userId:    text("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("mant_equipment_history_vehicle_idx").on(table.vehicleId, table.createdAt),
  check("mant_equipment_history_action_valid", sql`${table.action} IN ('create', 'update', 'schedule_change', 'retire', 'reactivate', 'import', 'initial_reading')`),
])

export const mantEquipmentProfilesRelations = relations(mantEquipmentProfiles, ({ one }) => ({
  vehicle:  one(fuelVehicles, { fields: [mantEquipmentProfiles.vehicleId], references: [fuelVehicles.id] }),
  brand:    one(mantBrands, { fields: [mantEquipmentProfiles.brandId], references: [mantBrands.id] }),
  schedule: one(mantSchedules, { fields: [mantEquipmentProfiles.scheduleId], references: [mantSchedules.id] }),
}))

export const mantEquipmentHistoryRelations = relations(mantEquipmentHistory, ({ one }) => ({
  vehicle: one(fuelVehicles, { fields: [mantEquipmentHistory.vehicleId], references: [fuelVehicles.id] }),
  user:    one(users, { fields: [mantEquipmentHistory.userId], references: [users.id] }),
}))

export const mantDriversRelations = relations(mantDrivers, ({ one }) => ({
  worker: one(workers, { fields: [mantDrivers.workerId], references: [workers.id] }),
}))

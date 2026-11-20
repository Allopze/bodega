import { relations, sql } from "drizzle-orm"
import { check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { fuelVehicles } from "./fuel-vehicles"
import { users } from "./users"
import { workers } from "./worksites"

/** Por qué un equipo no trabajó un día sin estar averiado (las averías van al estado del equipo). */
export type FleetDayMarkReason = "sin_operacion_programada" | "otro"

/**
 * Turno de operación: quién operó un equipo entre dos horas enteras de un día.
 *
 * - `shift_date` es la fecha civil en que el turno EMPIEZA; si `end_hour <= start_hour`,
 *   termina al día siguiente (el turno de noche 22–06 lleva la fecha de las 22).
 * - La faena NO se guarda: es la del equipo ese día (`stayWorksiteOnDaySql`).
 * - Se anula, no se borra: un turno anulado deja de contar pero queda para la auditoría.
 * - `import_ref` identifica un turno traído de la página «Ralentí Cholguán» (`ralenti:<id>`)
 *   para que importar dos veces no duplique.
 */
export const fleetOperationShifts = pgTable("fleet_operation_shifts", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "restrict" }),
  shiftDate: text("shift_date").notNull(),
  startHour: integer("start_hour").notNull(),
  endHour: integer("end_hour").notNull(),
  operatorWorkerId: text("operator_worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  /** Nombre del operador al registrar: el turno se sigue leyendo si el trabajador cambia o se da de baja. */
  operatorNameSnapshot: text("operator_name_snapshot").notNull(),
  notes: text("notes").notNull().default(""),
  importRef: text("import_ref"),
  createdBy: text("created_by").notNull().references(() => users.id),
  updatedBy: text("updated_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedBy: text("voided_by").references(() => users.id),
  voidReason: text("void_reason"),
}, (table) => [
  check("fleet_operation_shifts_date_format", sql`${table.shiftDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  check("fleet_operation_shifts_hours_valid", sql`${table.startHour} BETWEEN 0 AND 23 AND ${table.endHour} BETWEEN 0 AND 23`),
  check("fleet_operation_shifts_not_empty", sql`${table.startHour} <> ${table.endHour}`),
  check("fleet_operation_shifts_void_complete", sql`
    (${table.voidedAt} IS NULL AND ${table.voidedBy} IS NULL AND ${table.voidReason} IS NULL)
    OR (${table.voidedAt} IS NOT NULL AND ${table.voidedBy} IS NOT NULL AND ${table.voidReason} IS NOT NULL)
  `),
  index("fleet_operation_shifts_vehicle_date_idx").on(table.vehicleId, table.shiftDate),
  index("fleet_operation_shifts_operator_date_idx").on(table.operatorWorkerId, table.shiftDate),
  uniqueIndex("fleet_operation_shifts_import_ref_unique").on(table.importRef).where(sql`${table.importRef} IS NOT NULL`),
])

/**
 * Telemetría por hora de reloj en Chile, desde los tramos de VisionLink (Asset Operations).
 * Una fila por equipo, día, hora y fuente; una hora consultada sin tramos no tiene fila
 * (= 0 s de motor), y si fue consultada lo dice `fuel_telemetry_fetches`.
 */
export const fuelTelemetryHourly = pgTable("fuel_telemetry_hourly", {
  vehicleId: text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  hour: integer("hour").notNull(),
  source: text("source").notNull(),
  idleSeconds: integer("idle_seconds").notNull().default(0),
  workingSeconds: integer("working_seconds").notNull().default(0),
  runningSeconds: integer("running_seconds").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.vehicleId, table.day, table.hour, table.source] }),
  check("fuel_telemetry_hourly_day_format", sql`${table.day} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  check("fuel_telemetry_hourly_hour_valid", sql`${table.hour} BETWEEN 0 AND 23`),
  check("fuel_telemetry_hourly_seconds_valid", sql`${table.idleSeconds} >= 0 AND ${table.workingSeconds} >= 0 AND ${table.runningSeconds} >= 0`),
  index("fuel_telemetry_hourly_day_idx").on(table.day),
])

/**
 * Constancia de consulta por equipo y día: distingue «0 min de motor» de «aún no llegó».
 * - `segments_fetched_at`: última vez que el sync de tramos consultó ese día.
 * - `daily_fetched_at`: última vez que el sync del resumen diario consultó ese día ya cerrado;
 *   con ella, la ausencia de fila diaria significa que el equipo no transmitió («Sin señal»).
 */
export const fuelTelemetryFetches = pgTable("fuel_telemetry_fetches", {
  vehicleId: text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  segmentsFetchedAt: timestamp("segments_fetched_at", { withTimezone: true, mode: "string" }),
  dailyFetchedAt: timestamp("daily_fetched_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  primaryKey({ columns: [table.vehicleId, table.day] }),
  check("fuel_telemetry_fetches_day_format", sql`${table.day} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
])

/** Un equipo que no trabajó un día sin estar averiado: «sin operación programada» u «otro». */
export const fleetOperationDayMarks = pgTable("fleet_operation_day_marks", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "restrict" }),
  day: text("day").notNull(),
  reason: text("reason").$type<FleetDayMarkReason>().notNull(),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fleet_operation_day_marks_day_format", sql`${table.day} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  check("fleet_operation_day_marks_reason_valid", sql`${table.reason} IN ('sin_operacion_programada', 'otro')`),
  uniqueIndex("fleet_operation_day_marks_vehicle_day_unique").on(table.vehicleId, table.day),
])

export const fleetOperationShiftsRelations = relations(fleetOperationShifts, ({ one }) => ({
  vehicle: one(fuelVehicles, { fields: [fleetOperationShifts.vehicleId], references: [fuelVehicles.id] }),
  operator: one(workers, { fields: [fleetOperationShifts.operatorWorkerId], references: [workers.id] }),
}))

export const fleetOperationDayMarksRelations = relations(fleetOperationDayMarks, ({ one }) => ({
  vehicle: one(fuelVehicles, { fields: [fleetOperationDayMarks.vehicleId], references: [fuelVehicles.id] }),
}))

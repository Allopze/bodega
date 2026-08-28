import { relations, sql } from "drizzle-orm"
import { boolean, check, foreignKey, index, integer, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { fuelVehicles } from "./fuel-vehicles"
import { users } from "./users"
import { workers, worksites } from "./worksites"

export const fleetGpsDriverMappings = pgTable("fleet_gps_driver_mappings", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("onway"),
  /** HMAC del identificador del portal: permite conciliar sin exponerlo en SQL. */
  externalDriverHash: text("external_driver_hash").notNull(),
  /** Cifrados con el keyring operativo; nunca se leen desde listas públicas. */
  externalDriverCiphertext: text("external_driver_ciphertext").notNull(),
  displayNameCiphertext: text("display_name_ciphertext"),
  workerId: text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  mappedByUserId: text("mapped_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fleet_gps_driver_mappings_provider_valid", sql`${table.provider} IN ('onway')`),
  uniqueIndex("fleet_gps_driver_mappings_external_unique").on(table.provider, table.externalDriverHash),
  index("fleet_gps_driver_mappings_worker_idx").on(table.workerId),
])

export const fleetGpsAlertRules = pgTable("fleet_gps_alert_rules", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("onway"),
  /** Null permite reglas derivadas, como movimiento fuera de horario. */
  alertType: text("alert_type"),
  category: text("category").notNull(),
  worksiteId: text("worksite_id").references(() => worksites.id, { onDelete: "cascade" }),
  destination: text("destination").notNull().default("none"),
  ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
  isEnabled: boolean("is_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fleet_gps_alert_rules_provider_valid", sql`${table.provider} IN ('onway')`),
  check("fleet_gps_alert_rules_destination_valid", sql`${table.destination} IN ('none', 'maintenance', 'capa')`),
  check("fleet_gps_alert_rules_cooldown_valid", sql`${table.cooldownMinutes} BETWEEN 1 AND 10080`),
  index("fleet_gps_alert_rules_worksite_idx").on(table.worksiteId, table.isEnabled),
  index("fleet_gps_alert_rules_alert_type_idx").on(table.provider, table.alertType),
])

/** Catálogo observado del portal: no activa automatizaciones por sí mismo. */
export const fleetGpsAlertTypes = pgTable("fleet_gps_alert_types", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("onway"),
  alertType: text("alert_type").notNull(),
  latestTitle: text("latest_title").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "string" }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fleet_gps_alert_types_provider_valid", sql`${table.provider} IN ('onway')`),
  uniqueIndex("fleet_gps_alert_types_external_unique").on(table.provider, table.alertType),
])

export const fleetGpsSyncRuns = pgTable("fleet_gps_sync_runs", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("onway"),
  trigger: text("trigger").notNull().default("manual"),
  status: text("status").notNull().default("running"),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  devicesReceived: integer("devices_received").notNull().default(0),
  devicesAccepted: integer("devices_accepted").notNull().default(0),
  devicesRejected: integer("devices_rejected").notNull().default(0),
  devicesUnmatched: integer("devices_unmatched").notNull().default(0),
  alertsReceived: integer("alerts_received").notNull().default(0),
  pointsReceived: integer("points_received").notNull().default(0),
  tripsReceived: integer("trips_received").notNull().default(0),
  errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  check("fleet_gps_sync_runs_provider_valid", sql`${table.provider} IN ('onway')`),
  check("fleet_gps_sync_runs_trigger_valid", sql`${table.trigger} IN ('manual', 'cron')`),
  check("fleet_gps_sync_runs_status_valid", sql`${table.status} IN ('running', 'success', 'partial', 'failed')`),
  check("fleet_gps_sync_runs_counts_valid", sql`
    ${table.devicesReceived} >= 0 AND ${table.devicesAccepted} >= 0
    AND ${table.devicesRejected} >= 0 AND ${table.devicesUnmatched} >= 0
    AND ${table.alertsReceived} >= 0 AND ${table.pointsReceived} >= 0 AND ${table.tripsReceived} >= 0
  `),
  index("fleet_gps_sync_runs_started_idx").on(table.startedAt),
  index("fleet_gps_sync_runs_status_idx").on(table.status),
])

/** Latest allowlisted telemetry only; sensitive portal payloads are never persisted. */
export const fleetGpsLatestPositions = pgTable("fleet_gps_latest_positions", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("onway"),
  externalDeviceId: text("external_device_id").notNull(),
  externalGroupId: text("external_group_id").notNull(),
  vehicleId: text("vehicle_id"),
  worksiteId: text("worksite_id"),
  sourcePlate: text("source_plate").notNull(),
  normalizedPlate: text("normalized_plate").notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7, mode: "number" }).notNull(),
  longitude: numeric("longitude", { precision: 10, scale: 7, mode: "number" }).notNull(),
  speedKph: numeric("speed_kph", { precision: 7, scale: 2, mode: "number" }).notNull(),
  headingDegrees: numeric("heading_degrees", { precision: 6, scale: 2, mode: "number" }).notNull(),
  ignition: boolean("ignition").notNull(),
  sourceStatus: text("source_status"),
  gpsReportedAt: timestamp("gps_reported_at", { withTimezone: true, mode: "string" }),
  gprsReportedAt: timestamp("gprs_reported_at", { withTimezone: true, mode: "string" }),
  gpsStatus: text("gps_status"),
  gprsStatus: text("gprs_status"),
  movementState: text("movement_state"),
  odometer: numeric("odometer", { precision: 14, scale: 2, mode: "number" }),
  hourMeter: numeric("hour_meter", { precision: 14, scale: 2, mode: "number" }),
  internalBatteryLevel: numeric("internal_battery_level", { precision: 7, scale: 2, mode: "number" }),
  externalPowerVolts: numeric("external_power_volts", { precision: 7, scale: 2, mode: "number" }),
  engineRpm: numeric("engine_rpm", { precision: 9, scale: 2, mode: "number" }),
  coolantTemperature: numeric("coolant_temperature", { precision: 7, scale: 2, mode: "number" }),
  fuelLevel: numeric("fuel_level", { precision: 7, scale: 2, mode: "number" }),
  temperature1: numeric("temperature_1", { precision: 7, scale: 2, mode: "number" }),
  humidity1: numeric("humidity_1", { precision: 7, scale: 2, mode: "number" }),
  driverMappingId: text("driver_mapping_id").references(() => fleetGpsDriverMappings.id, { onDelete: "set null" }),
  observedAt: timestamp("observed_at", { withTimezone: true, mode: "string" }).notNull(),
  syncRunId: text("sync_run_id").notNull().references(() => fleetGpsSyncRuns.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.vehicleId, table.worksiteId],
    foreignColumns: [fuelVehicles.id, fuelVehicles.worksiteId],
    name: "fleet_gps_latest_positions_vehicle_worksite_fk",
  }).onUpdate("cascade").onDelete("cascade"),
  check("fleet_gps_latest_positions_provider_valid", sql`${table.provider} IN ('onway')`),
  check("fleet_gps_latest_positions_vehicle_scope_consistent", sql`
    (${table.vehicleId} IS NULL AND ${table.worksiteId} IS NULL)
    OR (${table.vehicleId} IS NOT NULL AND ${table.worksiteId} IS NOT NULL)
  `),
  check("fleet_gps_latest_positions_coordinates_valid", sql`
    ${table.latitude} BETWEEN -90 AND 90 AND ${table.longitude} BETWEEN -180 AND 180
  `),
  check("fleet_gps_latest_positions_motion_valid", sql`
    ${table.speedKph} BETWEEN 0 AND 400 AND ${table.headingDegrees} >= 0 AND ${table.headingDegrees} < 360
  `),
  check("fleet_gps_latest_positions_battery_valid", sql`${table.internalBatteryLevel} IS NULL OR ${table.internalBatteryLevel} BETWEEN 0 AND 100`),
  check("fleet_gps_latest_positions_fuel_valid", sql`${table.fuelLevel} IS NULL OR ${table.fuelLevel} BETWEEN 0 AND 100`),
  check("fleet_gps_latest_positions_humidity_valid", sql`${table.humidity1} IS NULL OR ${table.humidity1} BETWEEN 0 AND 100`),
  uniqueIndex("fleet_gps_latest_positions_device_unique").on(table.provider, table.externalDeviceId),
  index("fleet_gps_latest_positions_vehicle_idx").on(table.vehicleId),
  index("fleet_gps_latest_positions_worksite_idx").on(table.worksiteId),
  index("fleet_gps_latest_positions_plate_idx").on(table.normalizedPlate),
  index("fleet_gps_latest_positions_observed_idx").on(table.observedAt),
])

/** Puntos crudos: se purgan a los 30 días; los viajes conservan sólo su resumen. */
export const fleetGpsPositionHistory = pgTable("fleet_gps_position_history", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("onway"),
  externalDeviceId: text("external_device_id").notNull(),
  externalPointKey: text("external_point_key").notNull(),
  vehicleId: text("vehicle_id"),
  worksiteId: text("worksite_id"),
  driverMappingId: text("driver_mapping_id").references(() => fleetGpsDriverMappings.id, { onDelete: "set null" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7, mode: "number" }).notNull(),
  longitude: numeric("longitude", { precision: 10, scale: 7, mode: "number" }).notNull(),
  speedKph: numeric("speed_kph", { precision: 7, scale: 2, mode: "number" }).notNull(),
  headingDegrees: numeric("heading_degrees", { precision: 6, scale: 2, mode: "number" }),
  ignition: boolean("ignition"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.vehicleId, table.worksiteId],
    foreignColumns: [fuelVehicles.id, fuelVehicles.worksiteId],
    name: "fleet_gps_position_history_vehicle_worksite_fk",
  }).onUpdate("cascade").onDelete("cascade"),
  check("fleet_gps_position_history_provider_valid", sql`${table.provider} IN ('onway')`),
  check("fleet_gps_position_history_scope_consistent", sql`(${table.vehicleId} IS NULL AND ${table.worksiteId} IS NULL) OR (${table.vehicleId} IS NOT NULL AND ${table.worksiteId} IS NOT NULL)`),
  check("fleet_gps_position_history_coordinates_valid", sql`${table.latitude} BETWEEN -90 AND 90 AND ${table.longitude} BETWEEN -180 AND 180`),
  check("fleet_gps_position_history_speed_valid", sql`${table.speedKph} BETWEEN 0 AND 400`),
  uniqueIndex("fleet_gps_position_history_external_unique").on(table.provider, table.externalDeviceId, table.externalPointKey),
  index("fleet_gps_position_history_vehicle_occurred_idx").on(table.vehicleId, table.occurredAt),
  index("fleet_gps_position_history_worksite_occurred_idx").on(table.worksiteId, table.occurredAt),
])

export const fleetGpsTrips = pgTable("fleet_gps_trips", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("onway"),
  externalDeviceId: text("external_device_id").notNull(),
  externalTripKey: text("external_trip_key").notNull(),
  vehicleId: text("vehicle_id"),
  worksiteId: text("worksite_id"),
  driverMappingId: text("driver_mapping_id").references(() => fleetGpsDriverMappings.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }).notNull(),
  distanceKm: numeric("distance_km", { precision: 12, scale: 3, mode: "number" }).notNull(),
  idleDuration: text("idle_duration"),
  movementDuration: text("movement_duration"),
  travelDuration: text("travel_duration"),
  beginOdometer: numeric("begin_odometer", { precision: 14, scale: 2, mode: "number" }),
  endOdometer: numeric("end_odometer", { precision: 14, scale: 2, mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.vehicleId, table.worksiteId], foreignColumns: [fuelVehicles.id, fuelVehicles.worksiteId], name: "fleet_gps_trips_vehicle_worksite_fk" }).onUpdate("cascade").onDelete("cascade"),
  check("fleet_gps_trips_provider_valid", sql`${table.provider} IN ('onway')`),
  check("fleet_gps_trips_scope_consistent", sql`(${table.vehicleId} IS NULL AND ${table.worksiteId} IS NULL) OR (${table.vehicleId} IS NOT NULL AND ${table.worksiteId} IS NOT NULL)`),
  check("fleet_gps_trips_duration_valid", sql`${table.endedAt} > ${table.startedAt}`),
  check("fleet_gps_trips_distance_valid", sql`${table.distanceKm} >= 0`),
  uniqueIndex("fleet_gps_trips_external_unique").on(table.provider, table.externalDeviceId, table.externalTripKey),
  index("fleet_gps_trips_vehicle_started_idx").on(table.vehicleId, table.startedAt),
])

export const fleetGpsAlerts = pgTable("fleet_gps_alerts", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("onway"),
  externalDeviceId: text("external_device_id").notNull(),
  externalEventKey: text("external_event_key").notNull(),
  vehicleId: text("vehicle_id"),
  worksiteId: text("worksite_id"),
  driverMappingId: text("driver_mapping_id").references(() => fleetGpsDriverMappings.id, { onDelete: "set null" }),
  alertType: text("alert_type").notNull(),
  category: text("category").notNull().default("unknown"),
  title: text("title").notNull(),
  priority: text("priority"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7, mode: "number" }),
  longitude: numeric("longitude", { precision: 10, scale: 7, mode: "number" }),
  speedKph: numeric("speed_kph", { precision: 7, scale: 2, mode: "number" }),
  processingStatus: text("processing_status").notNull().default("new"),
  ruleId: text("rule_id").references(() => fleetGpsAlertRules.id, { onDelete: "set null" }),
  linkedEntityType: text("linked_entity_type"),
  linkedEntityId: text("linked_entity_id"),
  coordinatesPurgedAt: timestamp("coordinates_purged_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.vehicleId, table.worksiteId], foreignColumns: [fuelVehicles.id, fuelVehicles.worksiteId], name: "fleet_gps_alerts_vehicle_worksite_fk" }).onUpdate("cascade").onDelete("cascade"),
  check("fleet_gps_alerts_provider_valid", sql`${table.provider} IN ('onway')`),
  check("fleet_gps_alerts_scope_consistent", sql`(${table.vehicleId} IS NULL AND ${table.worksiteId} IS NULL) OR (${table.vehicleId} IS NOT NULL AND ${table.worksiteId} IS NOT NULL)`),
  check("fleet_gps_alerts_coordinates_valid", sql`(${table.latitude} IS NULL AND ${table.longitude} IS NULL) OR (${table.latitude} BETWEEN -90 AND 90 AND ${table.longitude} BETWEEN -180 AND 180)`),
  check("fleet_gps_alerts_speed_valid", sql`${table.speedKph} IS NULL OR ${table.speedKph} BETWEEN 0 AND 400`),
  check("fleet_gps_alerts_status_valid", sql`${table.processingStatus} IN ('new', 'actioned', 'ignored', 'blocked')`),
  check("fleet_gps_alerts_link_valid", sql`(${table.linkedEntityType} IS NULL AND ${table.linkedEntityId} IS NULL) OR (${table.linkedEntityType} IN ('maintenance', 'capa') AND ${table.linkedEntityId} IS NOT NULL)`),
  uniqueIndex("fleet_gps_alerts_external_unique").on(table.provider, table.externalDeviceId, table.externalEventKey),
  index("fleet_gps_alerts_worksite_status_idx").on(table.worksiteId, table.processingStatus, table.occurredAt),
  index("fleet_gps_alerts_vehicle_occurred_idx").on(table.vehicleId, table.occurredAt),
])

export const fleetGpsSyncRunsRelations = relations(fleetGpsSyncRuns, ({ one, many }) => ({
  actor: one(users, { fields: [fleetGpsSyncRuns.actorUserId], references: [users.id] }),
  positions: many(fleetGpsLatestPositions),
}))

export const fleetGpsLatestPositionsRelations = relations(fleetGpsLatestPositions, ({ one }) => ({
  vehicle: one(fuelVehicles, { fields: [fleetGpsLatestPositions.vehicleId], references: [fuelVehicles.id] }),
  worksite: one(worksites, { fields: [fleetGpsLatestPositions.worksiteId], references: [worksites.id] }),
  syncRun: one(fleetGpsSyncRuns, { fields: [fleetGpsLatestPositions.syncRunId], references: [fleetGpsSyncRuns.id] }),
  driverMapping: one(fleetGpsDriverMappings, { fields: [fleetGpsLatestPositions.driverMappingId], references: [fleetGpsDriverMappings.id] }),
}))

export const fleetGpsDriverMappingsRelations = relations(fleetGpsDriverMappings, ({ one }) => ({
  worker: one(workers, { fields: [fleetGpsDriverMappings.workerId], references: [workers.id] }),
  mappedBy: one(users, { fields: [fleetGpsDriverMappings.mappedByUserId], references: [users.id] }),
}))

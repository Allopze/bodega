import { relations, sql } from "drizzle-orm"
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { fuelVehicles } from "./fuel-vehicles"
import { users } from "./users"
import { worksites } from "./worksites"

/** Cómo nació una estadía: el alta del equipo, un traslado o la reconstrucción del pasado. */
export type FleetStaySource = "alta" | "traslado" | "reconstruccion"

/**
 * Un traslado de equipos entre faenas: la decisión (quién la autorizó, por qué y
 * desde qué día), no el detalle por equipo. Se anula, no se borra, con el mismo
 * contrato que `deliveries`: motivo de diez caracteres, responsable y fecha, los
 * tres juntos o ninguno.
 */
export const fleetTransfers = pgTable("fleet_transfers", {
  id: text("id").primaryKey(),
  /** Correlativo legible (p. ej. `TR-0001`). */
  folio: text("folio").notNull().unique(),
  /** Fecha civil `YYYY-MM-DD`: el día del traslado ya cuenta en la faena nueva. */
  effectiveDate: text("effective_date").notNull(),
  toWorksiteId: text("to_worksite_id").notNull().references(() => worksites.id),
  reason: text("reason").notNull(),
  /** Quién de Gerencia lo decidió; puede no ser usuario de la plataforma. */
  authorizedBy: text("authorized_by").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedBy: text("voided_by").references(() => users.id),
  voidReason: text("void_reason"),
}, (table) => [
  check("fleet_transfers_reason_valid", sql`char_length(trim(${table.reason})) >= 10`),
  check("fleet_transfers_authorized_by_valid", sql`char_length(trim(${table.authorizedBy})) >= 3`),
  check("fleet_transfers_void_complete", sql`
    (${table.voidedAt} IS NULL AND ${table.voidedBy} IS NULL AND ${table.voidReason} IS NULL)
    OR (${table.voidedAt} IS NOT NULL AND ${table.voidedBy} IS NOT NULL
      AND char_length(trim(${table.voidReason})) >= 10)
  `),
  index("fleet_transfers_effective_date_idx").on(table.effectiveDate),
  index("fleet_transfers_to_worksite_idx").on(table.toWorksiteId),
])

/** Un equipo dentro de un traslado, con la faena de la que salió. */
export const fleetTransferItems = pgTable("fleet_transfer_items", {
  id: text("id").primaryKey(),
  transferId: text("transfer_id").notNull().references(() => fleetTransfers.id, { onDelete: "cascade" }),
  vehicleId: text("vehicle_id").notNull().references(() => fuelVehicles.id),
  fromWorksiteId: text("from_worksite_id").notNull().references(() => worksites.id),
}, (table) => [
  uniqueIndex("fleet_transfer_items_transfer_vehicle_unique").on(table.transferId, table.vehicleId),
  index("fleet_transfer_items_vehicle_idx").on(table.vehicleId),
])

/**
 * Recorrido de un equipo por las faenas. `started_on` inclusivo; `ended_on` es el
 * día anterior al `started_on` de la estadía siguiente (inclusivo). La primera
 * estadía no tiene inicio (nulo = «desde siempre») para que ningún dato antiguo
 * quede sin faena. Una sola abierta por equipo, sin solapes ni huecos: lo
 * garantizan el índice parcial y los triggers de la migración.
 */
export const fuelVehicleWorksiteIntervals = pgTable("fuel_vehicle_worksite_intervals", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "cascade" }),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id),
  startedOn: text("started_on"),
  endedOn: text("ended_on"),
  source: text("source").$type<FleetStaySource>().notNull(),
  transferId: text("transfer_id").references(() => fleetTransfers.id),
  /** Para `reconstruccion`: qué registros sostienen la estadía. */
  evidence: text("evidence"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_vehicle_worksite_intervals_source_valid", sql`${table.source} IN ('alta', 'traslado', 'reconstruccion')`),
  check("fuel_vehicle_worksite_intervals_transfer_consistent", sql`(${table.source} = 'traslado') = (${table.transferId} IS NOT NULL)`),
  check("fuel_vehicle_worksite_intervals_dates_valid", sql`${table.startedOn} IS NULL OR ${table.endedOn} IS NULL OR ${table.endedOn} >= ${table.startedOn}`),
  uniqueIndex("fuel_vehicle_worksite_intervals_open_unique").on(table.vehicleId).where(sql`${table.endedOn} IS NULL`),
  uniqueIndex("fuel_vehicle_worksite_intervals_first_unique").on(table.vehicleId).where(sql`${table.startedOn} IS NULL`),
  index("fuel_vehicle_worksite_intervals_vehicle_started_idx").on(table.vehicleId, table.startedOn),
  index("fuel_vehicle_worksite_intervals_worksite_idx").on(table.worksiteId),
])

export const fleetTransfersRelations = relations(fleetTransfers, ({ one, many }) => ({
  toWorksite: one(worksites, { fields: [fleetTransfers.toWorksiteId], references: [worksites.id] }),
  creator: one(users, { fields: [fleetTransfers.createdBy], references: [users.id], relationName: "fleetTransferCreator" }),
  voider: one(users, { fields: [fleetTransfers.voidedBy], references: [users.id], relationName: "fleetTransferVoider" }),
  items: many(fleetTransferItems),
  stays: many(fuelVehicleWorksiteIntervals),
}))

export const fleetTransferItemsRelations = relations(fleetTransferItems, ({ one }) => ({
  transfer: one(fleetTransfers, { fields: [fleetTransferItems.transferId], references: [fleetTransfers.id] }),
  vehicle: one(fuelVehicles, { fields: [fleetTransferItems.vehicleId], references: [fuelVehicles.id] }),
  fromWorksite: one(worksites, { fields: [fleetTransferItems.fromWorksiteId], references: [worksites.id] }),
}))

export const fuelVehicleWorksiteIntervalsRelations = relations(fuelVehicleWorksiteIntervals, ({ one }) => ({
  vehicle: one(fuelVehicles, { fields: [fuelVehicleWorksiteIntervals.vehicleId], references: [fuelVehicles.id] }),
  worksite: one(worksites, { fields: [fuelVehicleWorksiteIntervals.worksiteId], references: [worksites.id] }),
  transfer: one(fleetTransfers, { fields: [fuelVehicleWorksiteIntervals.transferId], references: [fleetTransfers.id] }),
}))

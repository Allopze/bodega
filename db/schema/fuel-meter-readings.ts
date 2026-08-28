import { relations, sql } from "drizzle-orm"
import { check, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { fuelVehicles } from "./fuel-vehicles"

/**
 * Lecturas de medidor observadas, una fila por transacción de carga.
 *
 * Existe porque el dato ya llegaba y se tiraba: el informe de detalle de Copec
 * trae `Odómetro (Kms.)` por transacción y Aramco trae `vehicleOdometer` en cada
 * movimiento, pero ambos parsers colapsan el mes a un agregado por patente y la
 * lectura sobrevivía sólo dentro del JSON de `raw_row`, sin que nadie la leyera.
 * Sobre datos reales, 27 de 249 pares consecutivos son regresivos (el operario
 * pierde un dígito al tipear en el surtidor: 720.325 queda como 72.000), y el
 * propio proveedor entrega rendimiento 0 en todas ellas.
 *
 * NO es una transacción de combustible y por eso no vive en
 * `fuel_provider_transactions`: la identidad de esa tabla es patente-mes y de
 * ella dependen la conciliación y el hash de proyección. Tampoco se proyecta a
 * `fuel_loads`, que alimenta el KPI de litros facturados: una carga por
 * transacción duplicaría litros contra el agregado de consumo.
 *
 * `meterType` se resuelve SIEMPRE contra `fuel_vehicles.meterType`, nunca contra
 * el archivo: Copec rotula la columna "Odómetro (Kms.)" incluso en las filas de
 * maquinaria que se mide por horómetro.
 */
export const fuelMeterReadings = pgTable("fuel_meter_readings", {
  id:        text("id").primaryKey(),
  /** Null mientras la patente no tenga vehículo en el catálogo. */
  vehicleId: text("vehicle_id").references(() => fuelVehicles.id),
  /** Patente tal como la normaliza `normalizePlate`, para las aún no resueltas. */
  plate:     text("plate").notNull(),
  source:    text("source").notNull(),
  /** Clave natural de la transacción en su fuente: guía de despacho (Copec) o
   *  `transactionId` (Aramco). Junto con `source` da la idempotencia. */
  sourceRef: text("source_ref").notNull(),
  /** Instante real de la carga en hora chilena, ISO 8601. Copec entrega fecha y
   *  hora en celdas separadas; `santiagoInstant` las compone. */
  occurredAt: text("occurred_at").notNull(),
  meterType: text("meter_type").notNull(),
  value:     numeric("value", { precision: 14, scale: 2, mode: "number" }).notNull(),
  liters:    numeric("liters", { precision: 14, scale: 4, mode: "number" }),
  stationName: text("station_name"),
  cardNumber:  text("card_number"),
  /** El km/L que declara el proveedor, para contrastarlo con el calculado. */
  providerPerformance: numeric("provider_performance", { precision: 10, scale: 4, mode: "number" }),
  /** Fila cruda SIN los datos personales del archivo (RUT de chofer y atendedor). */
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_meter_readings_source_valid", sql`${table.source} IN ('copec_tct', 'aramco', 'gps_onway')`),
  check("fuel_meter_readings_meter_type_valid", sql`${table.meterType} IN ('odometer', 'hour_meter')`),
  check("fuel_meter_readings_value_positive", sql`${table.value} >= 0`),
  check("fuel_meter_readings_liters_positive", sql`${table.liters} IS NULL OR ${table.liters} >= 0`),
  uniqueIndex("fuel_meter_readings_source_ref_unique").on(table.source, table.sourceRef),
  // El detector recorre la serie de un equipo en orden cronológico dentro de una
  // misma fuente: lecturas de fuentes distintas no son comparables entre sí.
  index("fuel_meter_readings_series_idx").on(table.vehicleId, table.source, table.meterType, table.occurredAt),
  index("fuel_meter_readings_plate_idx").on(table.plate),
  index("fuel_meter_readings_occurred_idx").on(table.occurredAt),
])

export const fuelMeterReadingsRelations = relations(fuelMeterReadings, ({ one }) => ({
  vehicle: one(fuelVehicles, { fields: [fuelMeterReadings.vehicleId], references: [fuelVehicles.id] }),
}))

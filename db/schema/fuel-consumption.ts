import { relations, sql } from "drizzle-orm"
import { pgTable, text, integer, numeric, jsonb, timestamp, check, index } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"
import { fuelVehicles } from "./fuel-vehicles"

/* ── Fuel Import Batch States ─────────────────────────────────────────────── */
// importado | revertido

/* ── Fuel Import Batches (lote de consumos por patente/periodo importado) ── */
export const fuelImportBatches = pgTable("fuel_import_batches", {
  id:                 text("id").primaryKey(),
  worksiteId:         text("worksite_id").notNull().references(() => worksites.id),
  // NOT NULL desde 0215: el guard de "import ajeno" filtra con `NOT IN (...)`,
  // y en SQL eso no matchea NULL — un lote sin fuente no bloqueaba nada.
  fuente:             text("fuente").notNull(),                     // proveedor / sistema de origen
  periodoDesde:       text("periodo_desde").notNull(),              // "2026-06-01"
  periodoHasta:       text("periodo_hasta").notNull(),              // "2026-06-30"
  archivoNombre:      text("archivo_nombre").notNull(),
  archivoPath:        text("archivo_path"),                         // ruta relativa en storage/imports/
  hashArchivo:        text("hash_archivo").notNull(),                // sha256 del archivo subido
  estado:             text("estado").notNull().default("importado"),
  totalFilas:         integer("total_filas").notNull().default(0),
  filasValidas:       integer("filas_validas").notNull().default(0),
  filasInvalidas:     integer("filas_invalidas").notNull().default(0),
  totalPatentes:      integer("total_patentes").notNull().default(0),
  totalTarjetas:      integer("total_tarjetas").notNull().default(0),
  totalTransacciones: integer("total_transacciones").notNull().default(0),
  totalCantidad:      numeric("total_cantidad", { precision: 14, scale: 4, mode: "number" }).notNull().default(0),
  totalMonto:         numeric("total_monto", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  importadoPor:       text("importado_por").notNull().references(() => users.id),
  notas:              text("notas"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_import_batches_estado_valid", sql`${table.estado} IN ('importado', 'revertido')`),
  check("fuel_import_batches_periodo_valid", sql`${table.periodoDesde} <= ${table.periodoHasta}`),
  index("fuel_import_batches_worksite_idx").on(table.worksiteId),
  index("fuel_import_batches_hash_idx").on(table.hashArchivo),
  index("fuel_import_batches_estado_idx").on(table.estado),
  index("fuel_import_batches_periodo_idx").on(table.periodoDesde, table.periodoHasta),
])

/* ── Fuel Consumption Records (consumo de una patente en un periodo) ─────── */
export const fuelConsumptionRecords = pgTable("fuel_consumption_records", {
  id:                    text("id").primaryKey(),
  batchId:               text("batch_id").notNull().references(() => fuelImportBatches.id, { onDelete: "cascade" }),
  worksiteId:            text("worksite_id").notNull().references(() => worksites.id),
  vehicleId:             text("vehicle_id").references(() => fuelVehicles.id),  // null = patente sin asociar
  patente:               text("patente").notNull(),                             // normalizada (mayúsculas, trim)
  numeroTarjetas:        integer("numero_tarjetas").notNull().default(0),
  numeroTransacciones:   integer("numero_transacciones").notNull().default(0),
  cantidadUnidad:        numeric("cantidad_unidad", { precision: 14, scale: 4, mode: "number" }).notNull(),
  monto:                 numeric("monto", { precision: 14, scale: 2, mode: "number" }).notNull(),
  rendimientoPromedio:   numeric("rendimiento_promedio", { precision: 10, scale: 4, mode: "number" }).notNull().default(0),
  precioPromedioUnidad:  numeric("precio_promedio_unidad", { precision: 14, scale: 2, mode: "number" }),  // null si cantidad = 0
  periodoDesde:          text("periodo_desde").notNull(),
  periodoHasta:          text("periodo_hasta").notNull(),
  fuente:                text("fuente"),
  rawRow:                jsonb("raw_row"),                          // valores crudos de la fila, para trazabilidad
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_consumption_records_cantidad_positive", sql`${table.cantidadUnidad} >= 0`),
  check("fuel_consumption_records_monto_positive", sql`${table.monto} >= 0`),
  index("fuel_consumption_records_batch_idx").on(table.batchId),
  index("fuel_consumption_records_worksite_idx").on(table.worksiteId),
  index("fuel_consumption_records_patente_idx").on(table.patente),
  index("fuel_consumption_records_vehicle_idx").on(table.vehicleId),
  index("fuel_consumption_records_periodo_idx").on(table.periodoDesde),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const fuelImportBatchesRelations = relations(fuelImportBatches, ({ one, many }) => ({
  worksite: one(worksites, { fields: [fuelImportBatches.worksiteId], references: [worksites.id] }),
  importer: one(users, { fields: [fuelImportBatches.importadoPor], references: [users.id] }),
  records:  many(fuelConsumptionRecords),
}))

export const fuelConsumptionRecordsRelations = relations(fuelConsumptionRecords, ({ one }) => ({
  batch:    one(fuelImportBatches, { fields: [fuelConsumptionRecords.batchId], references: [fuelImportBatches.id] }),
  worksite: one(worksites, { fields: [fuelConsumptionRecords.worksiteId], references: [worksites.id] }),
  vehicle:  one(fuelVehicles, { fields: [fuelConsumptionRecords.vehicleId], references: [fuelVehicles.id] }),
}))

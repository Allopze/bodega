import { relations, sql } from "drizzle-orm"
import { pgTable, text, integer, numeric, jsonb, timestamp, check, index } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"
import { fuelVehicles } from "./fuel-vehicles"
import { fuelSuppliers } from "./fuel-suppliers"

/* ── Fuel Operation Batch States ──────────────────────────────────────────── */
// importado | revertido

/* ── Fuel Operation Batches (lote de log operacional de carga por transacción,
 *   ej. "CONSOLIDADO COMBUSTIBLES CHOME") ─────────────────────────────────── */
export const fuelOperationBatches = pgTable("fuel_operation_batches", {
  id:                 text("id").primaryKey(),
  archivoNombre:      text("archivo_nombre").notNull(),
  archivoPath:        text("archivo_path"),                         // ruta relativa en storage/imports/
  hashArchivo:        text("hash_archivo").notNull(),                // sha256 del archivo subido
  estado:             text("estado").notNull().default("importado"),
  periodoDesde:       text("periodo_desde").notNull(),               // derivado del min(FECHA) del archivo
  periodoHasta:       text("periodo_hasta").notNull(),               // derivado del max(FECHA) del archivo
  totalFilas:         integer("total_filas").notNull().default(0),
  filasValidas:       integer("filas_validas").notNull().default(0),
  filasInvalidas:     integer("filas_invalidas").notNull().default(0),
  totalEquipos:       integer("total_equipos").notNull().default(0),
  totalLitros:        numeric("total_litros", { precision: 14, scale: 4, mode: "number" }).notNull().default(0),
  totalMonto:         numeric("total_monto", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  importadoPor:       text("importado_por").notNull().references(() => users.id),
  notas:              text("notas"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_operation_batches_estado_valid", sql`${table.estado} IN ('importado', 'revertido')`),
  check("fuel_operation_batches_periodo_valid", sql`${table.periodoDesde} <= ${table.periodoHasta}`),
  index("fuel_operation_batches_hash_idx").on(table.hashArchivo),
  index("fuel_operation_batches_estado_idx").on(table.estado),
  index("fuel_operation_batches_periodo_idx").on(table.periodoDesde, table.periodoHasta),
])

/* ── Fuel Operation Records (una carga individual con contexto operacional:
 *   fecha, horómetro, operador, supervisor, proveedor, rendimiento) ────────── */
export const fuelOperationRecords = pgTable("fuel_operation_records", {
  id:                text("id").primaryKey(),
  batchId:           text("batch_id").notNull().references(() => fuelOperationBatches.id, { onDelete: "cascade" }),
  worksiteId:        text("worksite_id").references(() => worksites.id),          // null = faena sin match
  vehicleId:         text("vehicle_id").references(() => fuelVehicles.id),        // null = patente sin asociar
  plate:             text("plate").notNull(),                                     // tal como viene en el archivo (mayúsculas, trim)
  code:              text("code"),                                                // código interno de equipo (ej. KA-63)
  faenaNombre:       text("faena_nombre"),                                        // texto crudo de FAENA, para reconciliar
  tipo:              text("tipo"),
  marca:             text("marca"),
  modelo:            text("modelo"),
  anio:              integer("anio"),
  fecha:             text("fecha").notNull(),                                     // "2026-01-15"
  horaCarga:         text("hora_carga"),                                          // "HH:MM"
  horometro:         numeric("horometro", { precision: 14, scale: 2, mode: "number" }),
  medidoPor:         text("medido_por"),                                          // km | hora
  liters:            numeric("liters", { precision: 12, scale: 4, mode: "number" }).notNull(),
  operador:          text("operador"),
  supervisor:        text("supervisor"),
  proveedorNombre:   text("proveedor_nombre"),                                    // texto crudo de SUMINISTRO ENTREGADO POR
  fuelSupplierId:    text("fuel_supplier_id").references(() => fuelSuppliers.id), // null = proveedor sin match
  precioLitro:       numeric("precio_litro", { precision: 14, scale: 2, mode: "number" }),
  monto:             numeric("monto", { precision: 14, scale: 2, mode: "number" }),
  rendimiento:       numeric("rendimiento", { precision: 10, scale: 4, mode: "number" }),
  tipoRendimiento:   text("tipo_rendimiento"),                                    // km_lt | lt_hr
  rawRow:            jsonb("raw_row"),                                            // valores crudos de la fila, para trazabilidad
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_operation_records_liters_positive", sql`${table.liters} >= 0`),
  index("fuel_operation_records_batch_idx").on(table.batchId),
  index("fuel_operation_records_worksite_idx").on(table.worksiteId),
  index("fuel_operation_records_vehicle_idx").on(table.vehicleId),
  index("fuel_operation_records_plate_idx").on(table.plate),
  index("fuel_operation_records_fecha_idx").on(table.fecha),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const fuelOperationBatchesRelations = relations(fuelOperationBatches, ({ one, many }) => ({
  importer: one(users, { fields: [fuelOperationBatches.importadoPor], references: [users.id] }),
  records:  many(fuelOperationRecords),
}))

export const fuelOperationRecordsRelations = relations(fuelOperationRecords, ({ one }) => ({
  batch:    one(fuelOperationBatches, { fields: [fuelOperationRecords.batchId], references: [fuelOperationBatches.id] }),
  worksite: one(worksites, { fields: [fuelOperationRecords.worksiteId], references: [worksites.id] }),
  vehicle:  one(fuelVehicles, { fields: [fuelOperationRecords.vehicleId], references: [fuelVehicles.id] }),
  supplier: one(fuelSuppliers, { fields: [fuelOperationRecords.fuelSupplierId], references: [fuelSuppliers.id] }),
}))

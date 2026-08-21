import { relations, sql } from "drizzle-orm"
import { pgTable, text, numeric, timestamp, check, foreignKey, index, uniqueIndex } from "drizzle-orm/pg-core"
import { costCenters } from "./cost-centers"
import { fuelVehicles } from "./fuel-vehicles"
import { preventionInspectionFindings } from "./prevention/inspections"
import { users } from "./users"
import { suppliers, worksites } from "./worksites"

/* ── Maintenance Records (mantenciones operativas de flota) ─────────────── */
export const maintenanceRecords = pgTable("maintenance_records", {
  id:               text("id").primaryKey(),
  vehicleId:        text("vehicle_id").notNull().references(() => fuelVehicles.id),
  supplierId:       text("supplier_id").references(() => suppliers.id),
  /* Faena propietaria del equipo, copiada del vehículo al escribir. No es una
   * dimensión editable: el destino contable se expresa con `cost_center_id`.
   * Sin `NOT NULL` las filas heredadas quedaban fuera de todo listado acotado
   * por faena y aun así eran mutables por ID. */
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id),
  costCenterId:     text("cost_center_id").references(() => costCenters.id),
  maintenanceDate:  text("maintenance_date").notNull(),
  maintenanceType:  text("maintenance_type").notNull(),
  status:           text("status").notNull().default("scheduled"),
  odometerReading:  numeric("odometer_reading", { precision: 12, scale: 2, mode: "number" }),
  hourMeterReading: numeric("hour_meter_reading", { precision: 12, scale: 2, mode: "number" }),
  netAmount:        numeric("net_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  taxAmount:        numeric("tax_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  totalAmount:      numeric("total_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  documentNumber:   text("document_number"),
  documentName:     text("document_name"),
  documentPath:     text("document_path"),
  documentMimeType: text("document_mime_type"),
  notes:            text("notes"),
  /* Hallazgo de inspección que originó esta mantención, cuando nació de una.
   * `set null` y no `cascade`: borrar el hallazgo no debe borrar el gasto ni el
   * historial del equipo, sólo su procedencia. */
  inspectionFindingId: text("inspection_finding_id").references(() => preventionInspectionFindings.id, { onDelete: "set null" }),
  createdBy:        text("created_by").notNull().references(() => users.id),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("maintenance_records_status_valid", sql`
    ${table.status} IN ('scheduled', 'in_progress', 'completed', 'cancelled')
  `),
  check("maintenance_records_amounts_non_negative", sql`
    ${table.netAmount} >= 0
    AND ${table.taxAmount} >= 0
    AND ${table.totalAmount} >= 0
  `),
  // La faena del registro es la del equipo, y lo sigue siendo cuando el equipo
  // se traslada: `ON UPDATE CASCADE` reencuadra el historial completo en la
  // misma operación, así que ningún importador, seed o script puede dejar el
  // gasto contado en una faena y el activo en otra.
  foreignKey({
    columns: [table.vehicleId, table.worksiteId],
    foreignColumns: [fuelVehicles.id, fuelVehicles.worksiteId],
    name: "maintenance_records_vehicle_worksite_fk",
  }).onUpdate("cascade"),
  index("maintenance_records_vehicle_date_idx").on(table.vehicleId, table.maintenanceDate),
  index("maintenance_records_worksite_idx").on(table.worksiteId),
  index("maintenance_records_cost_center_idx").on(table.costCenterId),
  index("maintenance_records_status_idx").on(table.status),
  // Idempotencia: un hallazgo deriva a lo más una mantención. Sin esto, dos
  // clics en "programar mantención" abren dos órdenes para la misma falla.
  uniqueIndex("maintenance_record_finding_unique").on(table.inspectionFindingId)
    .where(sql`${table.inspectionFindingId} IS NOT NULL`),
])

export const maintenanceRecordsRelations = relations(maintenanceRecords, ({ one }) => ({
  vehicle: one(fuelVehicles, { fields: [maintenanceRecords.vehicleId], references: [fuelVehicles.id] }),
  supplier: one(suppliers, { fields: [maintenanceRecords.supplierId], references: [suppliers.id] }),
  worksite: one(worksites, { fields: [maintenanceRecords.worksiteId], references: [worksites.id] }),
  costCenter: one(costCenters, { fields: [maintenanceRecords.costCenterId], references: [costCenters.id] }),
  creator: one(users, { fields: [maintenanceRecords.createdBy], references: [users.id] }),
}))

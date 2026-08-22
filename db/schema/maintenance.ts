import { relations, sql } from "drizzle-orm"
import { pgTable, text, numeric, timestamp, check, foreignKey, index, uniqueIndex, integer, boolean, type AnyPgColumn } from "drizzle-orm/pg-core"
import { costCenters } from "./cost-centers"
import { fuelVehicles } from "./fuel-vehicles"
import { fuelEquipmentTypes } from "./fuel-equipment-types"
import { preventionInspectionFindings } from "./prevention/inspections"
import { users } from "./users"
import { suppliers, worksites } from "./worksites"

/* ── Planes preventivos configurables por activo ─────────────────────────── */
export const maintenancePlans = pgTable("maintenance_plans", {
  id:               text("id").primaryKey(),
  vehicleId:        text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "cascade" }),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id),
  name:             text("name").notNull(),
  maintenanceType:  text("maintenance_type").notNull(),
  strategy:         text("strategy").notNull(),
  intervalDays:     integer("interval_days"),
  intervalUnits:    numeric("interval_units", { precision: 12, scale: 2, mode: "number" }),
  advanceDays:      integer("advance_days").notNull().default(7),
  advanceUnits:     numeric("advance_units", { precision: 12, scale: 2, mode: "number" }).notNull().default(100),
  nextDueDate:      text("next_due_date"),
  nextDueReading:   numeric("next_due_reading", { precision: 12, scale: 2, mode: "number" }),
  assignedToUserId: text("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  supplierId:       text("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  costCenterId:     text("cost_center_id").references(() => costCenters.id, { onDelete: "set null" }),
  instructions:     text("instructions"),
  isActive:         boolean("is_active").notNull().default(true),
  version:          integer("version").notNull().default(1),
  createdBy:        text("created_by").notNull().references(() => users.id),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.vehicleId, table.worksiteId],
    foreignColumns: [fuelVehicles.id, fuelVehicles.worksiteId],
    name: "maintenance_plans_vehicle_worksite_fk",
  }).onUpdate("cascade"),
  check("maintenance_plans_strategy_valid", sql`${table.strategy} IN ('calendar', 'odometer', 'hour_meter', 'combined')`),
  check("maintenance_plans_interval_valid", sql`
    (${table.strategy} IN ('calendar', 'combined') AND ${table.intervalDays} > 0 OR ${table.strategy} NOT IN ('calendar', 'combined') AND ${table.intervalDays} IS NULL)
    AND (${table.strategy} IN ('odometer', 'hour_meter', 'combined') AND ${table.intervalUnits} > 0 OR ${table.strategy} NOT IN ('odometer', 'hour_meter', 'combined') AND ${table.intervalUnits} IS NULL)
  `),
  check("maintenance_plans_advance_nonnegative", sql`${table.advanceDays} >= 0 AND ${table.advanceUnits} >= 0`),
  check("maintenance_plans_version_positive", sql`${table.version} >= 1`),
  index("maintenance_plans_vehicle_active_idx").on(table.vehicleId, table.isActive),
  index("maintenance_plans_worksite_active_idx").on(table.worksiteId, table.isActive),
  index("maintenance_plans_due_date_idx").on(table.nextDueDate, table.isActive),
])

/* ── Maintenance Records (mantenciones operativas de flota) ─────────────── */
export const maintenanceRecords = pgTable("maintenance_records", {
  id:               text("id").primaryKey(),
  code:             text("code").unique(),
  planId:           text("plan_id").references(() => maintenancePlans.id, { onDelete: "set null" }),
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
  priority:         text("priority").notNull().default("normal"),
  assignedToUserId: text("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  slaDueAt:         timestamp("sla_due_at", { withTimezone: true, mode: "string" }),
  startedAt:        timestamp("started_at", { withTimezone: true, mode: "string" }),
  completedAt:      timestamp("completed_at", { withTimezone: true, mode: "string" }),
  cancelledAt:      timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  cancellationReason: text("cancellation_reason"),
  downtimeStartedAt: timestamp("downtime_started_at", { withTimezone: true, mode: "string" }),
  downtimeEndedAt:  timestamp("downtime_ended_at", { withTimezone: true, mode: "string" }),
  rootCause:        text("root_cause"),
  underWarranty:    boolean("under_warranty").notNull().default(false),
  costApprovalStatus: text("cost_approval_status").notNull().default("not_required"),
  costApprovedByUserId: text("cost_approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  costApprovedAt:   timestamp("cost_approved_at", { withTimezone: true, mode: "string" }),
  operationalImpact: text("operational_impact").notNull().default("maintenance"),
  managesOperationalStatus: boolean("manages_operational_status").notNull().default(false),
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
  version:          integer("version").notNull().default(1),
}, (table) => [
  check("maintenance_records_status_valid", sql`
    ${table.status} IN ('scheduled', 'in_progress', 'completed', 'cancelled')
  `),
  check("maintenance_records_amounts_non_negative", sql`
    ${table.netAmount} >= 0
    AND ${table.taxAmount} >= 0
    AND ${table.totalAmount} >= 0
  `),
  check("maintenance_records_priority_valid", sql`${table.priority} IN ('low', 'normal', 'high', 'critical')`),
  check("maintenance_records_cost_approval_valid", sql`${table.costApprovalStatus} IN ('not_required', 'pending', 'approved', 'rejected')`),
  check("maintenance_records_operational_impact_valid", sql`${table.operationalImpact} IN ('none', 'maintenance', 'out_of_service')`),
  check("maintenance_records_cancel_consistent", sql`${table.status} <> 'cancelled' OR (${table.cancelledAt} IS NOT NULL AND length(${table.cancellationReason}) >= 5)`),
  check("maintenance_records_dates_valid", sql`${table.downtimeEndedAt} IS NULL OR (${table.downtimeStartedAt} IS NOT NULL AND ${table.downtimeEndedAt} >= ${table.downtimeStartedAt})`),
  check("maintenance_records_version_positive", sql`${table.version} >= 1`),
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
  index("maintenance_records_plan_idx").on(table.planId, table.status),
  index("maintenance_records_assignee_sla_idx").on(table.assignedToUserId, table.slaDueAt, table.status),
  // Idempotencia: un hallazgo deriva a lo más una mantención. Sin esto, dos
  // clics en "programar mantención" abren dos órdenes para la misma falla.
  uniqueIndex("maintenance_record_finding_unique").on(table.inspectionFindingId)
    .where(sql`${table.inspectionFindingId} IS NOT NULL`),
  uniqueIndex("maintenance_record_plan_due_unique").on(table.planId, table.maintenanceDate)
    .where(sql`${table.planId} IS NOT NULL AND ${table.status} <> 'cancelled'`),
])

export const maintenanceTasks = pgTable("maintenance_tasks", {
  id:              text("id").primaryKey(),
  maintenanceId:   text("maintenance_id").notNull().references(() => maintenanceRecords.id, { onDelete: "cascade" }),
  description:     text("description").notNull(),
  status:          text("status").notNull().default("pending"),
  completedBy:     text("completed_by").references(() => users.id, { onDelete: "set null" }),
  completedAt:     timestamp("completed_at", { withTimezone: true, mode: "string" }),
  sortOrder:       integer("sort_order").notNull().default(0),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("maintenance_tasks_status_valid", sql`${table.status} IN ('pending', 'completed', 'cancelled')`),
  check("maintenance_tasks_completion_consistent", sql`${table.status} <> 'completed' OR (${table.completedBy} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`),
  index("maintenance_tasks_order_idx").on(table.maintenanceId, table.sortOrder),
])

export const maintenanceParts = pgTable("maintenance_parts", {
  id:              text("id").primaryKey(),
  maintenanceId:   text("maintenance_id").notNull().references(() => maintenanceRecords.id, { onDelete: "cascade" }),
  description:     text("description").notNull(),
  partNumber:      text("part_number"),
  quantity:        numeric("quantity", { precision: 12, scale: 3, mode: "number" }).notNull(),
  unit:            text("unit").notNull().default("un"),
  unitCost:        numeric("unit_cost", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("maintenance_parts_values_positive", sql`${table.quantity} > 0 AND ${table.unitCost} >= 0`),
  index("maintenance_parts_maintenance_idx").on(table.maintenanceId),
])

export const maintenanceLabor = pgTable("maintenance_labor", {
  id:              text("id").primaryKey(),
  maintenanceId:   text("maintenance_id").notNull().references(() => maintenanceRecords.id, { onDelete: "cascade" }),
  description:     text("description").notNull(),
  hours:           numeric("hours", { precision: 10, scale: 2, mode: "number" }).notNull(),
  hourlyRate:      numeric("hourly_rate", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("maintenance_labor_values_positive", sql`${table.hours} > 0 AND ${table.hourlyRate} >= 0`),
  index("maintenance_labor_maintenance_idx").on(table.maintenanceId),
])

export const maintenanceDocuments = pgTable("maintenance_documents", {
  id:              text("id").primaryKey(),
  maintenanceId:   text("maintenance_id").notNull().references(() => maintenanceRecords.id, { onDelete: "cascade" }),
  documentType:    text("document_type").notNull(),
  fileName:        text("file_name").notNull(),
  filePath:        text("file_path").notNull(),
  fileSize:        integer("file_size"),
  mimeType:        text("mime_type"),
  status:          text("status").notNull().default("current"),
  supersededAt:    timestamp("superseded_at", { withTimezone: true, mode: "string" }),
  supersededBy:    text("superseded_by").references((): AnyPgColumn => maintenanceDocuments.id, { onDelete: "set null" }),
  uploadedBy:      text("uploaded_by").notNull().references(() => users.id),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("maintenance_documents_status_valid", sql`${table.status} IN ('current', 'replaced')`),
  check("maintenance_documents_type_valid", sql`${table.documentType} IN ('quote', 'diagnosis', 'work_order', 'invoice', 'evidence', 'other')`),
  uniqueIndex("maintenance_documents_current_unique").on(table.maintenanceId, table.documentType)
    .where(sql`${table.status} = 'current'`),
  index("maintenance_documents_maintenance_idx").on(table.maintenanceId, table.createdAt),
])

export const maintenanceDocumentPolicies = pgTable("maintenance_document_policies", {
  id:              text("id").primaryKey(),
  equipmentTypeId: text("equipment_type_id").notNull().references(() => fuelEquipmentTypes.id, { onDelete: "cascade" }),
  documentType:    text("document_type").notNull(),
  requiredAt:      text("required_at").notNull(),
  isActive:        boolean("is_active").notNull().default(true),
  createdBy:       text("created_by").notNull().references(() => users.id),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("maintenance_document_policies_type_valid", sql`${table.documentType} IN ('quote', 'diagnosis', 'work_order', 'invoice', 'evidence', 'other')`),
  check("maintenance_document_policies_required_at_valid", sql`${table.requiredAt} IN ('before_start', 'before_complete')`),
  uniqueIndex("maintenance_document_policies_unique").on(table.equipmentTypeId, table.documentType, table.requiredAt),
  index("maintenance_document_policies_active_idx").on(table.equipmentTypeId, table.isActive),
])

export const maintenanceRecordsRelations = relations(maintenanceRecords, ({ one, many }) => ({
  plan: one(maintenancePlans, { fields: [maintenanceRecords.planId], references: [maintenancePlans.id] }),
  vehicle: one(fuelVehicles, { fields: [maintenanceRecords.vehicleId], references: [fuelVehicles.id] }),
  supplier: one(suppliers, { fields: [maintenanceRecords.supplierId], references: [suppliers.id] }),
  worksite: one(worksites, { fields: [maintenanceRecords.worksiteId], references: [worksites.id] }),
  costCenter: one(costCenters, { fields: [maintenanceRecords.costCenterId], references: [costCenters.id] }),
  creator: one(users, { fields: [maintenanceRecords.createdBy], references: [users.id] }),
  assignee: one(users, { fields: [maintenanceRecords.assignedToUserId], references: [users.id], relationName: "maintenance_assignee" }),
  tasks: many(maintenanceTasks),
  parts: many(maintenanceParts),
  labor: many(maintenanceLabor),
  documents: many(maintenanceDocuments),
}))

export const maintenancePlansRelations = relations(maintenancePlans, ({ one, many }) => ({
  vehicle: one(fuelVehicles, { fields: [maintenancePlans.vehicleId], references: [fuelVehicles.id] }),
  worksite: one(worksites, { fields: [maintenancePlans.worksiteId], references: [worksites.id] }),
  assignee: one(users, { fields: [maintenancePlans.assignedToUserId], references: [users.id], relationName: "maintenance_plan_assignee" }),
  supplier: one(suppliers, { fields: [maintenancePlans.supplierId], references: [suppliers.id] }),
  costCenter: one(costCenters, { fields: [maintenancePlans.costCenterId], references: [costCenters.id] }),
  records: many(maintenanceRecords),
}))

export const maintenanceTasksRelations = relations(maintenanceTasks, ({ one }) => ({
  maintenance: one(maintenanceRecords, { fields: [maintenanceTasks.maintenanceId], references: [maintenanceRecords.id] }),
}))

export const maintenancePartsRelations = relations(maintenanceParts, ({ one }) => ({
  maintenance: one(maintenanceRecords, { fields: [maintenanceParts.maintenanceId], references: [maintenanceRecords.id] }),
}))

export const maintenanceLaborRelations = relations(maintenanceLabor, ({ one }) => ({
  maintenance: one(maintenanceRecords, { fields: [maintenanceLabor.maintenanceId], references: [maintenanceRecords.id] }),
}))

export const maintenanceDocumentsRelations = relations(maintenanceDocuments, ({ one }) => ({
  maintenance: one(maintenanceRecords, { fields: [maintenanceDocuments.maintenanceId], references: [maintenanceRecords.id] }),
}))

export const maintenanceDocumentPoliciesRelations = relations(maintenanceDocumentPolicies, ({ one }) => ({
  equipmentType: one(fuelEquipmentTypes, { fields: [maintenanceDocumentPolicies.equipmentTypeId], references: [fuelEquipmentTypes.id] }),
}))

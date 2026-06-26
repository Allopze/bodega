import { relations, sql } from "drizzle-orm"
import { pgTable, text, numeric, timestamp, check, index } from "drizzle-orm/pg-core"
import { costCenters } from "./cost-centers"
import { fuelLoads } from "./fuel-invoices"
import { fuelVehicles } from "./fuel-vehicles"
import { maintenanceRecords } from "./maintenance"
import { purchaseOrderItems } from "./purchasing"
import { worksites } from "./worksites"

/* ── Vehicle Cost Allocations ────────────────────────────────────────────── */
export const vehicleCostAllocations = pgTable("vehicle_cost_allocations", {
  id:                  text("id").primaryKey(),
  vehicleId:           text("vehicle_id").notNull().references(() => fuelVehicles.id),
  worksiteId:          text("worksite_id").references(() => worksites.id),
  costCenterId:        text("cost_center_id").references(() => costCenters.id),
  purchaseOrderItemId: text("purchase_order_item_id").references(() => purchaseOrderItems.id, { onDelete: "cascade" }),
  fuelLoadId:          text("fuel_load_id").references(() => fuelLoads.id, { onDelete: "cascade" }),
  maintenanceRecordId: text("maintenance_record_id").references(() => maintenanceRecords.id, { onDelete: "cascade" }),
  costCategory:        text("cost_category").notNull().default("parts"),
  allocationDate:      text("allocation_date").notNull(),
  amount:              numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  notes:               text("notes"),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("vehicle_cost_allocations_category_valid", sql`
    ${table.costCategory} IN ('fuel', 'parts', 'service', 'maintenance', 'other')
  `),
  check("vehicle_cost_allocations_amount_non_negative", sql`${table.amount} >= 0`),
  check("vehicle_cost_allocations_source_present", sql`
    ${table.purchaseOrderItemId} IS NOT NULL
    OR ${table.fuelLoadId} IS NOT NULL
    OR ${table.maintenanceRecordId} IS NOT NULL
  `),
  index("vehicle_cost_allocations_vehicle_date_idx").on(table.vehicleId, table.allocationDate),
  index("vehicle_cost_allocations_worksite_idx").on(table.worksiteId),
  index("vehicle_cost_allocations_cost_center_idx").on(table.costCenterId),
  index("vehicle_cost_allocations_category_idx").on(table.costCategory),
])

export const vehicleCostAllocationsRelations = relations(vehicleCostAllocations, ({ one }) => ({
  vehicle: one(fuelVehicles, { fields: [vehicleCostAllocations.vehicleId], references: [fuelVehicles.id] }),
  worksite: one(worksites, { fields: [vehicleCostAllocations.worksiteId], references: [worksites.id] }),
  costCenter: one(costCenters, { fields: [vehicleCostAllocations.costCenterId], references: [costCenters.id] }),
  purchaseOrderItem: one(purchaseOrderItems, {
    fields: [vehicleCostAllocations.purchaseOrderItemId],
    references: [purchaseOrderItems.id],
  }),
  fuelLoad: one(fuelLoads, { fields: [vehicleCostAllocations.fuelLoadId], references: [fuelLoads.id] }),
  maintenanceRecord: one(maintenanceRecords, {
    fields: [vehicleCostAllocations.maintenanceRecordId],
    references: [maintenanceRecords.id],
  }),
}))

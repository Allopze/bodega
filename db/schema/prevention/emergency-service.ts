import { relations, sql } from "drizzle-orm"
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { purchaseRequestItems } from "../requests"
import { receiptItems } from "../receiving"
import { users } from "../users"
import {
  preventionEmergencyResourcePoints,
  preventionEmergencyResources,
} from "./emergency"

/**
 * Caso que atraviesa Solicitud -> OC -> Recepción sin duplicar costo,
 * proveedor ni factura. Esos datos siguen perteneciendo al flujo de compras.
 */
export const preventionEmergencyResourceServiceCases = pgTable("prevention_emergency_resource_service_cases", {
  id:                  text("id").primaryKey(),
  resourceId:          text("resource_id").notNull().references(() => preventionEmergencyResources.id, { onDelete: "restrict" }),
  previousPointId:     text("previous_point_id").references(() => preventionEmergencyResourcePoints.id, { onDelete: "set null" }),
  requestItemId:       text("request_item_id").notNull().references(() => purchaseRequestItems.id, { onDelete: "restrict" }),
  completedReceiptItemId: text("completed_receipt_item_id").references(() => receiptItems.id, { onDelete: "restrict" }),
  status:              text("status").notNull().default("open"),
  openedByUserId:      text("opened_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  completedByUserId:   text("completed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  openedAt:            timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  completedAt:         timestamp("completed_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  uniqueIndex("prevention_emergency_resource_service_case_request_item_unique").on(table.requestItemId),
  uniqueIndex("prevention_emergency_resource_service_case_open_resource_unique")
    .on(table.resourceId).where(sql`${table.status} = 'open'`),
  index("prevention_emergency_resource_service_case_resource_idx").on(table.resourceId, table.openedAt),
  check("prevention_emergency_resource_service_case_status_valid", sql`${table.status} IN ('open', 'completed', 'cancelled')`),
  check("prevention_emergency_resource_service_case_completion_valid", sql`
    (${table.status} = 'completed' AND ${table.completedAt} IS NOT NULL AND ${table.completedReceiptItemId} IS NOT NULL)
    OR (${table.status} <> 'completed' AND ${table.completedAt} IS NULL)
  `),
])

export const preventionEmergencyResourceServiceCasesRelations = relations(preventionEmergencyResourceServiceCases, ({ one }) => ({
  resource: one(preventionEmergencyResources, { fields: [preventionEmergencyResourceServiceCases.resourceId], references: [preventionEmergencyResources.id] }),
  previousPoint: one(preventionEmergencyResourcePoints, { fields: [preventionEmergencyResourceServiceCases.previousPointId], references: [preventionEmergencyResourcePoints.id] }),
  requestItem: one(purchaseRequestItems, { fields: [preventionEmergencyResourceServiceCases.requestItemId], references: [purchaseRequestItems.id] }),
  completedReceiptItem: one(receiptItems, { fields: [preventionEmergencyResourceServiceCases.completedReceiptItemId], references: [receiptItems.id] }),
}))

export type PreventionEmergencyResourceServiceCase = typeof preventionEmergencyResourceServiceCases.$inferSelect

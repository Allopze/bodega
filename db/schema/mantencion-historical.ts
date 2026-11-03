import { sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { fuelVehicles } from "./fuel-vehicles"
import { users } from "./users"
import { worksites } from "./worksites"
import type { HistoricalField } from "@/lib/services/mantencion/historical-workbook"

/** Antecedentes de formularios anteriores: no son registros firmados ni alimentan el estado operativo. */
export const mantHistoricalRecords = pgTable("mant_historical_records", {
  sourceKey: text("source_key").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  sourceFile: text("source_file").notNull(),
  sourceSheet: text("source_sheet").notNull(),
  sourceRow: integer("source_row").notNull(),
  submittedAt: text("submitted_at").notNull(),
  worksiteText: text("worksite_text").notNull(),
  worksiteId: text("worksite_id").references(() => worksites.id, { onDelete: "restrict" }),
  equipmentText: text("equipment_text").notNull(),
  vehicleId: text("vehicle_id").references(() => fuelVehicles.id, { onDelete: "restrict" }),
  equipmentMatch: text("equipment_match").notNull(),
  orderText: text("order_text").notNull(),
  kindText: text("kind_text").notNull(),
  readingText: text("reading_text").notNull(),
  description: text("description").notNull(),
  entryDate: text("entry_date"),
  exitDate: text("exit_date"),
  hoursText: text("hours_text").notNull(),
  fields: jsonb("fields").$type<HistoricalField[]>().notNull(),
  importedBy: text("imported_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  importedAt: timestamp("imported_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("mant_historical_records_vehicle_date_idx").on(table.vehicleId, table.entryDate),
  index("mant_historical_records_worksite_date_idx").on(table.worksiteId, table.entryDate),
  check("mant_historical_records_source_row_valid", sql`${table.sourceRow} >= 2`),
  check("mant_historical_records_match_valid", sql`(${table.equipmentMatch} = 'linked' AND ${table.vehicleId} IS NOT NULL) OR (${table.equipmentMatch} IN ('unmatched', 'conflict') AND ${table.vehicleId} IS NULL)`),
])

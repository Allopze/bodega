import { sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core"
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
  // ── Consolidado (2026-11-21, Trinorma) ──
  // Lo completa el importador del consolidado, también sobre filas que ya
  // existían por otra vía (las 142 del formulario nuevo cargadas el 18-11):
  // agrega datos, nunca cambia `fields`, `fingerprint` ni el archivo de origen.
  /** ID del registro en el consolidado (`MT-00001`). Referencia, no identidad: puede cambiar entre versiones. */
  sourceRecordId: text("source_record_id"),
  /** Formulario de origen según el consolidado (columna FUENTE). */
  originSource: text("origin_source"),
  /** Tipo de acción normalizado; `sin_clasificar` cuando el formulario no lo preguntó. Null = no derivado. */
  actionType: text("action_type"),
  /** Horas hombre informadas, como número. */
  laborHours: numeric("labor_hours", { precision: 8, scale: 2, mode: "number" }),
  /** Días detenido declarados (sólo el formulario nuevo los pregunta). */
  downtimeDays: numeric("downtime_days", { precision: 7, scale: 1, mode: "number" }),
  /** Especialidades: mecánica, eléctrica, soldadura, hidráulica. */
  specialties: text("specialties").array(),
  /** Contrato que trae la fila (Residuos, Calymag, Rodantes). Texto de origen, sin vínculo. */
  contractText: text("contract_text"),
  /** Observaciones de calidad del consolidado (OBS_CALIDAD), tal cual. */
  qualityNotes: text("quality_notes"),
  /** Posible fila de prueba (POSIBLE_PRUEBA). Se importa marcada; el tablero la excluye. */
  isTest: boolean("is_test").notNull().default(false),
}, (table) => [
  index("mant_historical_records_vehicle_date_idx").on(table.vehicleId, table.entryDate),
  index("mant_historical_records_source_record_idx").on(table.sourceRecordId),
  check("mant_historical_records_action_type_valid", sql`${table.actionType} IS NULL OR ${table.actionType} IN ('preventiva', 'correctiva', 'predictiva', 'sin_clasificar')`),
  check("mant_historical_records_specialties_valid", sql`${table.specialties} IS NULL OR ${table.specialties} <@ ARRAY['mecanica', 'electrica', 'soldadura', 'hidraulica']::text[]`),
  check("mant_historical_records_numbers_valid", sql`(${table.laborHours} IS NULL OR ${table.laborHours} >= 0) AND (${table.downtimeDays} IS NULL OR ${table.downtimeDays} >= 0)`),
  index("mant_historical_records_worksite_date_idx").on(table.worksiteId, table.entryDate),
  check("mant_historical_records_source_row_valid", sql`${table.sourceRow} >= 2`),
  check("mant_historical_records_match_valid", sql`(${table.equipmentMatch} = 'linked' AND ${table.vehicleId} IS NOT NULL) OR (${table.equipmentMatch} IN ('unmatched', 'conflict') AND ${table.vehicleId} IS NULL)`),
])

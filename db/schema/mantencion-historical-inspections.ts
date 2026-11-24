import { sql } from "drizzle-orm"
import { boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { fuelVehicles } from "./fuel-vehicles"
import { users } from "./users"
import { worksites } from "./worksites"
import type { HistoricalField } from "@/lib/services/mantencion/historical-workbook"

/*
 * Antecedentes de los Google Forms de inspección diaria y de pauta preventiva,
 * importados desde el consolidado (2026-11-21, Trinorma). Igual que
 * `mant_historical_records`: no son registros firmados, no alimentan el estado
 * operativo, el semáforo ni las alertas, y no tocan las inspecciones de
 * Prevención (`prevention_inspection_*`), que son otro flujo con sus propios
 * indicadores de SST. Sólo los leen los indicadores retrospectivos del Panel.
 *
 * Identidad: `source_key` se deriva de lo que trae el formulario (marca
 * temporal, unidad, ítem), no del ID que le puso el consolidado, que cambia si
 * se rearma la planilla. Volver a importar el mismo archivo no cambia nada.
 */

const matchValid = (match: unknown, vehicle: unknown) =>
  sql`(${match} = 'linked' AND ${vehicle} IS NOT NULL) OR (${match} IN ('unmatched', 'conflict') AND ${vehicle} IS NULL)`

/** Una unidad inspeccionada: un formulario de camión trae camión y carro (dos filas). */
export const mantHistoricalInspections = pgTable("mant_historical_inspections", {
  sourceKey: text("source_key").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  sourceFile: text("source_file").notNull(),
  sourceSheet: text("source_sheet").notNull(),
  sourceRow: integer("source_row").notNull(),
  /** ID en el consolidado (`IN-00001`). Referencia, no identidad. */
  sourceRecordId: text("source_record_id"),
  /** Envío del formulario, `YYYY-MM-DD HH:MM:SS`. */
  submittedAt: text("submitted_at").notNull(),
  /** Día inspeccionado, `YYYY-MM-DD`. */
  inspectionDate: text("inspection_date").notNull(),
  /** Formulario usado (CAMION, TRACTO, BATEA…). */
  formKind: text("form_kind").notNull(),
  /** Unidad de esta fila (CAMION, CARRO, TRACTO, BATEA…). */
  unitKind: text("unit_kind").notNull(),
  equipmentText: text("equipment_text").notNull(),
  vehicleId: text("vehicle_id").references(() => fuelVehicles.id, { onDelete: "restrict" }),
  equipmentMatch: text("equipment_match").notNull(),
  worksiteText: text("worksite_text").notNull(),
  worksiteId: text("worksite_id").references(() => worksites.id, { onDelete: "restrict" }),
  /** Kilometraje u horómetro declarado en la inspección. */
  reading: numeric("reading", { precision: 14, scale: 1, mode: "number" }),
  goodCount: integer("good_count").notNull().default(0),
  regularCount: integer("regular_count").notNull().default(0),
  badCount: integer("bad_count").notNull().default(0),
  missingCount: integer("missing_count").notNull().default(0),
  notApplicableCount: integer("not_applicable_count").notNull().default(0),
  fields: jsonb("fields").$type<HistoricalField[]>().notNull(),
  importedBy: text("imported_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  importedAt: timestamp("imported_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("mant_historical_inspections_vehicle_date_idx").on(table.vehicleId, table.inspectionDate),
  index("mant_historical_inspections_worksite_date_idx").on(table.worksiteId, table.inspectionDate),
  check("mant_historical_inspections_source_row_valid", sql`${table.sourceRow} >= 2`),
  check("mant_historical_inspections_match_valid", matchValid(table.equipmentMatch, table.vehicleId)),
  check("mant_historical_inspections_counts_valid", sql`${table.goodCount} >= 0 AND ${table.regularCount} >= 0 AND ${table.badCount} >= 0 AND ${table.missingCount} >= 0 AND ${table.notApplicableCount} >= 0`),
])

/**
 * Un ítem de una inspección en estado Regular, Mal o No tiene. El equipo y la
 * faena son los de la inspección (se unen por `inspection_source_key`), para
 * que una conciliación posterior no deje datos desfasados.
 */
export const mantHistoricalFindings = pgTable("mant_historical_findings", {
  sourceKey: text("source_key").primaryKey(),
  inspectionSourceKey: text("inspection_source_key").notNull(),
  sourceRow: integer("source_row").notNull(),
  /** Día de la inspección, `YYYY-MM-DD`. */
  foundOn: text("found_on").notNull(),
  section: text("section").notNull(),
  item: text("item").notNull(),
  /** `regular`, `mal` o `no_tiene`. */
  condition: text("condition").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Nombre explícito: el autogenerado pasa de 63 bytes y Postgres lo truncaría.
  foreignKey({
    columns: [table.inspectionSourceKey],
    foreignColumns: [mantHistoricalInspections.sourceKey],
    name: "mant_historical_findings_inspection_fk",
  }).onDelete("restrict"),
  index("mant_historical_findings_inspection_idx").on(table.inspectionSourceKey),
  index("mant_historical_findings_condition_date_idx").on(table.condition, table.foundOn),
  check("mant_historical_findings_condition_valid", sql`${table.condition} IN ('regular', 'mal', 'no_tiene')`),
  check("mant_historical_findings_source_row_valid", sql`${table.sourceRow} >= 2`),
])

/** Una pauta preventiva ejecutada (formulario MANTENCIONES PREVENTIVAS). */
export const mantHistoricalScheduleChecks = pgTable("mant_historical_schedule_checks", {
  sourceKey: text("source_key").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  sourceFile: text("source_file").notNull(),
  sourceSheet: text("source_sheet").notNull(),
  sourceRow: integer("source_row").notNull(),
  /** Envío del formulario, `YYYY-MM-DD HH:MM:SS`. */
  submittedAt: text("submitted_at").notNull(),
  /** Fecha en que se hizo la pauta, `YYYY-MM-DD`, si la informa. */
  performedOn: text("performed_on"),
  /** Formulario usado (CAMIONES, MAQUINAS…). */
  formKind: text("form_kind").notNull(),
  /** Pauta declarada, tal cual (`40.000 KM`). */
  scheduleLabel: text("schedule_label").notNull(),
  equipmentText: text("equipment_text").notNull(),
  vehicleId: text("vehicle_id").references(() => fuelVehicles.id, { onDelete: "restrict" }),
  equipmentMatch: text("equipment_match").notNull(),
  worksiteText: text("worksite_text").notNull(),
  worksiteId: text("worksite_id").references(() => worksites.id, { onDelete: "restrict" }),
  reading: numeric("reading", { precision: 14, scale: 1, mode: "number" }),
  doneCount: integer("done_count").notNull().default(0),
  notDoneCount: integer("not_done_count").notNull().default(0),
  notApplicableCount: integer("not_applicable_count").notNull().default(0),
  /** Realizados / (realizados + no realizados), de 0 a 1. */
  compliance: numeric("compliance", { precision: 5, scale: 4, mode: "number" }),
  /** Mecánico que ejecutó la pauta, tal como lo trae el consolidado. */
  mechanic: text("mechanic"),
  /** Observaciones de la pauta. */
  observations: text("observations"),
  /** Ítems no realizados, tal como los trae el consolidado (separados por «;»). */
  itemsNotDone: text("items_not_done").array(),
  /** Enlaces de respaldo del formulario (Google Drive): se guardan como evidencia, no se descargan. */
  filtersPhotoUrl: text("filters_photo_url"),
  stickerPhotoUrl: text("sticker_photo_url"),
  /** Fila de prueba (ES_PRUEBA). Se importa marcada; el tablero la excluye. */
  isTest: boolean("is_test").notNull().default(false),
  fields: jsonb("fields").$type<HistoricalField[]>().notNull(),
  importedBy: text("imported_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  importedAt: timestamp("imported_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("mant_historical_schedule_checks_vehicle_date_idx").on(table.vehicleId, table.performedOn),
  index("mant_historical_schedule_checks_worksite_date_idx").on(table.worksiteId, table.performedOn),
  check("mant_historical_schedule_checks_source_row_valid", sql`${table.sourceRow} >= 2`),
  check("mant_historical_schedule_checks_match_valid", matchValid(table.equipmentMatch, table.vehicleId)),
  check("mant_historical_schedule_checks_counts_valid", sql`${table.doneCount} >= 0 AND ${table.notDoneCount} >= 0 AND ${table.notApplicableCount} >= 0`),
  check("mant_historical_schedule_checks_compliance_valid", sql`${table.compliance} IS NULL OR (${table.compliance} >= 0 AND ${table.compliance} <= 1)`),
])

/**
 * Detalle por ítem de una pauta preventiva importada («Detalle por ítem», bloque que
 * sigue a la tabla resumen de PAUTAS_PREVENTIVAS en el consolidado). Es lo que permite
 * dibujar la matriz ítem × mantención sin volver a leer el archivo.
 *
 * No tiene marca temporal propia: se vincula a la pauta resumen por formulario + fecha
 * + patente + pauta. Una clave ambigua se rechaza en la importación y se informa.
 */
export const mantHistoricalScheduleItems = pgTable("mant_historical_schedule_items", {
  /** sha256(clave de la pauta + nombre del ítem). */
  sourceKey:      text("source_key").primaryKey(),
  checkSourceKey: text("check_source_key").notNull(),
  itemName:       text("item_name").notNull(),
  /** `realizado`, `no_realizado` o `no_aplica`. */
  result:         text("result").notNull(),
  sortOrder:      integer("sort_order").notNull().default(0),
  importedAt:     timestamp("imported_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.checkSourceKey],
    foreignColumns: [mantHistoricalScheduleChecks.sourceKey],
    name: "mant_historical_schedule_items_check_fk",
  }).onDelete("cascade"),
  uniqueIndex("mant_historical_schedule_items_name_unique").on(table.checkSourceKey, table.itemName),
  index("mant_historical_schedule_items_check_idx").on(table.checkSourceKey, table.sortOrder),
  check("mant_historical_schedule_items_result_valid", sql`${table.result} IN ('realizado', 'no_realizado', 'no_aplica')`),
  check("mant_historical_schedule_items_sort_valid", sql`${table.sortOrder} >= 0`),
])

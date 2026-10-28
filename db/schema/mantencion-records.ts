import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core"
import { fuelVehicles } from "./fuel-vehicles"
import { users } from "./users"
import { worksites } from "./worksites"
import { mantDrivers, mantWorkshops } from "./mantencion-catalogs"
import { mantSchedules } from "./mantencion-schedules"

/** El equipo tal como era al firmar. Editar la ficha después no cambia el documento. */
export interface MantEquipmentSnapshot {
  code:      string
  plate:     string
  noPlate:   boolean
  type:      string
  brand:     string
  model:     string | null
  year:      number | null
  worksite:  string
  unit:      "km" | "h"
}

/**
 * Registro de mantención firmado en el teléfono del mecánico.
 *
 * `id` lo genera el teléfono (UUID) y es la clave de idempotencia del envío: el
 * mismo registro llega tres veces y queda una fila. El `folio` lo pone el
 * servidor al recibirlo. Un registro firmado **nunca se edita**: lo único que
 * cambia después es `status` (anulación), `review` (observación/revisión) y el
 * PDF archivado.
 */
export const mantRecords = pgTable("mant_records", {
  id:                     text("id").primaryKey(),
  folio:                  text("folio"),
  kind:                   text("kind").notNull(),
  vehicleId:              text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "restrict" }),
  equipmentSnapshot:      jsonb("equipment_snapshot").$type<MantEquipmentSnapshot>().notNull(),
  worksiteId:             text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  outOfWorksite:          boolean("out_of_worksite").notNull().default(false),
  reading:                numeric("reading", { precision: 14, scale: 1, mode: "number" }).notNull(),
  unit:                   text("unit").notNull(),
  workDate:               text("work_date").notNull(),
  registeredBy:           text("registered_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  executorKind:           text("executor_kind").notNull(),
  executorUserId:         text("executor_user_id").references(() => users.id, { onDelete: "restrict" }),
  executorWorkshopId:     text("executor_workshop_id").references(() => mantWorkshops.id, { onDelete: "restrict" }),
  executorName:           text("executor_name").notNull(),
  signedAt:               timestamp("signed_at", { withTimezone: true, mode: "string" }).notNull(),
  receivedAt:             timestamp("received_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  /** Desde cuándo el teléfono estaba sin señal cuando se firmó (null: se firmó con señal). */
  offlineSince:           timestamp("offline_since", { withTimezone: true, mode: "string" }),
  deviceId:               text("device_id"),
  appVersion:             text("app_version"),
  status:                 text("status").notNull().default("vigente"),
  review:                 text("review").notNull().default("pendiente"),
  readingJumpAlert:       boolean("reading_jump_alert").notNull().default(false),
  readingJumpConfirmed:   boolean("reading_jump_confirmed").notNull().default(false),
  duplicateOfRecordId:    text("duplicate_of_record_id").references((): AnyPgColumn => mantRecords.id, { onDelete: "set null" }),
  duplicateConfirmed:     boolean("duplicate_confirmed").notNull().default(false),
  /** Registro anulado que éste corrige (regla 13). */
  correctsRecordId:       text("corrects_record_id").references((): AnyPgColumn => mantRecords.id, { onDelete: "set null" }),
  // ── Sólo preventiva ──
  scheduleId:             text("schedule_id").references(() => mantSchedules.id, { onDelete: "set null" }),
  scheduleVersion:        integer("schedule_version"),
  scheduleNameSnapshot:   text("schedule_name_snapshot"),
  intervalValue:          integer("interval_value"),
  suggestedIntervalValue: integer("suggested_interval_value"),
  manualScheduleReason:   text("manual_schedule_reason"),
  notes:                  text("notes"),
  // ── PDF archivado (se genera una vez; se regenera sólo al anular) ──
  pdfStorageKey:          text("pdf_storage_key"),
  pdfGeneratedAt:         timestamp("pdf_generated_at", { withTimezone: true, mode: "string" }),
  createdAt:              timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:              timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mant_records_folio_unique").on(table.folio),
  index("mant_records_vehicle_date_idx").on(table.vehicleId, table.workDate.desc()),
  index("mant_records_worksite_date_idx").on(table.worksiteId, table.workDate),
  index("mant_records_registered_by_idx").on(table.registeredBy),
  index("mant_records_executor_idx").on(table.executorUserId),
  index("mant_records_status_idx").on(table.status),
  index("mant_records_review_idx").on(table.review),
  check("mant_records_kind_valid", sql`${table.kind} IN ('P', 'C')`),
  check("mant_records_unit_valid", sql`${table.unit} IN ('km', 'h')`),
  check("mant_records_reading_valid", sql`${table.reading} >= 0`),
  check("mant_records_status_valid", sql`${table.status} IN ('vigente', 'anulado')`),
  check("mant_records_review_valid", sql`${table.review} IN ('pendiente', 'observado', 'revisado')`),
  check("mant_records_executor_valid", sql`
    (${table.executorKind} = 'yo' AND ${table.executorUserId} = ${table.registeredBy} AND ${table.executorWorkshopId} IS NULL)
    OR (${table.executorKind} = 'otro_mecanico' AND ${table.executorUserId} IS NOT NULL AND ${table.executorWorkshopId} IS NULL)
    OR (${table.executorKind} = 'externo' AND ${table.executorWorkshopId} IS NOT NULL AND ${table.executorUserId} IS NULL)
  `),
  check("mant_records_preventive_complete", sql`
    ${table.kind} <> 'P' OR (
      ${table.scheduleVersion} IS NOT NULL AND ${table.scheduleNameSnapshot} IS NOT NULL
      AND ${table.intervalValue} IS NOT NULL AND ${table.suggestedIntervalValue} IS NOT NULL
      AND char_length(trim(coalesce(${table.notes}, ''))) >= 3
      AND (${table.intervalValue} = ${table.suggestedIntervalValue}
           OR char_length(trim(coalesce(${table.manualScheduleReason}, ''))) >= 3)
    )
  `),
])

/** Resultado de cada ítem de una preventiva, con su snapshot de nombre y sistema. */
export const mantRecordItems = pgTable("mant_record_items", {
  id:                  text("id").primaryKey(),
  recordId:            text("record_id").notNull().references(() => mantRecords.id, { onDelete: "cascade" }),
  itemKey:             text("item_key").notNull(),
  groupName:           text("group_name").notNull(),
  itemName:            text("item_name").notNull(),
  sortOrder:           integer("sort_order").notNull().default(0),
  value:               text("value").notNull(),
  reason:              text("reason"),
  manufacturerWarning: boolean("manufacturer_warning").notNull().default(false),
}, (table) => [
  index("mant_record_items_record_idx").on(table.recordId),
  uniqueIndex("mant_record_items_key_unique").on(table.recordId, table.itemKey),
  check("mant_record_items_value_valid", sql`${table.value} IN ('R', 'NR', 'NA')`),
  check("mant_record_items_reason_valid", sql`${table.value} <> 'NR' OR char_length(trim(coalesce(${table.reason}, ''))) >= 3`),
])

/** Datos propios de una correctiva. Tipos de trabajo y aceites van como nombres (snapshot). */
export const mantRecordCorrectives = pgTable("mant_record_correctives", {
  recordId:          text("record_id").primaryKey().references(() => mantRecords.id, { onDelete: "cascade" }),
  workTypes:         jsonb("work_types").$type<string[]>().notNull(),
  /** Vacío = «No se cambió aceite». */
  oils:              jsonb("oils").$type<string[]>().notNull(),
  description:       text("description").notNull(),
  noParts:           boolean("no_parts").notNull().default(false),
  hours:             numeric("hours", { precision: 4, scale: 1, mode: "number" }).notNull(),
  inWorkshop:        boolean("in_workshop").notNull(),
  workshopEntryDate: text("workshop_entry_date"),
  workOrder:         text("work_order"),
}, (table) => [
  check("mant_record_correctives_description_valid", sql`char_length(trim(${table.description})) >= 5`),
  check("mant_record_correctives_hours_valid", sql`${table.hours} >= 0.5 AND ${table.hours} <= 72 AND (${table.hours} * 2) = floor(${table.hours} * 2)`),
  check("mant_record_correctives_workshop_valid", sql`NOT ${table.inWorkshop} OR ${table.workshopEntryDate} IS NOT NULL`),
  check("mant_record_correctives_work_types_valid", sql`jsonb_array_length(${table.workTypes}) >= 1`),
])

export const mantRecordParts = pgTable("mant_record_parts", {
  id:          text("id").primaryKey(),
  recordId:    text("record_id").notNull().references(() => mantRecords.id, { onDelete: "cascade" }),
  quantity:    numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull(),
  description: text("description").notNull(),
  sortOrder:   integer("sort_order").notNull().default(0),
}, (table) => [
  index("mant_record_parts_record_idx").on(table.recordId),
  check("mant_record_parts_quantity_positive", sql`${table.quantity} > 0`),
])

export const mantRecordDrivers = pgTable("mant_record_drivers", {
  recordId:   text("record_id").notNull().references(() => mantRecords.id, { onDelete: "cascade" }),
  driverId:   text("driver_id").notNull().references(() => mantDrivers.id, { onDelete: "restrict" }),
  driverName: text("driver_name").notNull(),
}, (table) => [
  primaryKey({ columns: [table.recordId, table.driverId], name: "mant_record_drivers_pk" }),
])

/**
 * Foto de respaldo. Se sube ANTES que el registro (`PUT` idempotente por `id`)
 * y queda huérfana (`record_id` nulo) hasta que llega el registro que la
 * nombra. `sha256` es del archivo recibido; el teléfono lo manda y el servidor
 * lo recalcula.
 */
export const mantRecordPhotos = pgTable("mant_record_photos", {
  id:          text("id").primaryKey(),
  recordId:    text("record_id").references(() => mantRecords.id, { onDelete: "restrict" }),
  kind:        text("kind").notNull(),
  storageKey:  text("storage_key").notNull(),
  mimeType:    text("mime_type").notNull(),
  sha256:      text("sha256").notNull(),
  bytes:       integer("bytes").notNull(),
  width:       integer("width").notNull(),
  height:      integer("height").notNull(),
  exif:        jsonb("exif").$type<Record<string, string>>(),
  takenAtExif: timestamp("taken_at_exif", { withTimezone: true, mode: "string" }),
  stampedAt:   timestamp("stamped_at", { withTimezone: true, mode: "string" }).notNull(),
  receivedAt:  timestamp("received_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  uploadedBy:  text("uploaded_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  deviceId:    text("device_id"),
  sortOrder:   integer("sort_order").notNull().default(0),
}, (table) => [
  index("mant_record_photos_record_idx").on(table.recordId),
  index("mant_record_photos_orphan_idx").on(table.uploadedBy, table.receivedAt).where(sql`${table.recordId} IS NULL`),
  check("mant_record_photos_kind_valid", sql`${table.kind} IN ('filtros', 'sticker', 'correctiva')`),
  check("mant_record_photos_bytes_valid", sql`${table.bytes} > 0 AND ${table.bytes} <= 10485760`),
])

/** «Sigue en taller» (nota obligatoria) o «Ya salió» (fecha). `id` lo genera el teléfono. */
export const mantWorkshopUpdates = pgTable("mant_workshop_updates", {
  id:         text("id").primaryKey(),
  recordId:   text("record_id").notNull().references(() => mantRecords.id, { onDelete: "restrict" }),
  kind:       text("kind").notNull(),
  note:       text("note"),
  exitDate:   text("exit_date"),
  userId:     text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  deviceId:   text("device_id"),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("mant_workshop_updates_record_idx").on(table.recordId, table.createdAt),
  check("mant_workshop_updates_kind_valid", sql`${table.kind} IN ('sigue', 'salio')`),
  check("mant_workshop_updates_payload_valid", sql`
    (${table.kind} = 'sigue' AND char_length(trim(coalesce(${table.note}, ''))) >= 3 AND ${table.exitDate} IS NULL)
    OR (${table.kind} = 'salio' AND ${table.exitDate} IS NOT NULL)
  `),
])

export const mantRecordVoids = pgTable("mant_record_voids", {
  id:        text("id").primaryKey(),
  recordId:  text("record_id").notNull().references(() => mantRecords.id, { onDelete: "restrict" }),
  reason:    text("reason").notNull(),
  userId:    text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mant_record_voids_record_unique").on(table.recordId),
  check("mant_record_voids_reason_valid", sql`char_length(trim(${table.reason})) >= 5`),
])

export const mantRecordObservations = pgTable("mant_record_observations", {
  id:          text("id").primaryKey(),
  recordId:    text("record_id").notNull().references(() => mantRecords.id, { onDelete: "restrict" }),
  text:        text("text").notNull(),
  userId:      text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  response:    text("response"),
  respondedBy: text("responded_by").references(() => users.id, { onDelete: "restrict" }),
  respondedAt: timestamp("responded_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  index("mant_record_observations_record_idx").on(table.recordId, table.createdAt),
  check("mant_record_observations_text_valid", sql`char_length(trim(${table.text})) >= 3`),
  check("mant_record_observations_response_valid", sql`
    (${table.response} IS NULL AND ${table.respondedBy} IS NULL AND ${table.respondedAt} IS NULL)
    OR (char_length(trim(${table.response})) >= 2 AND ${table.respondedBy} IS NOT NULL AND ${table.respondedAt} IS NOT NULL)
  `),
])

/** Correlativo por faena y tipo. Se incrementa con `INSERT … ON CONFLICT DO UPDATE … RETURNING`. */
export const mantFolioCounters = pgTable("mant_folio_counters", {
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  kind:       text("kind").notNull(),
  last:       integer("last").notNull().default(0),
  updatedAt:  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.worksiteId, table.kind], name: "mant_folio_counters_pk" }),
  check("mant_folio_counters_kind_valid", sql`${table.kind} IN ('P', 'C')`),
])

export const mantRecordsRelations = relations(mantRecords, ({ one, many }) => ({
  vehicle:          one(fuelVehicles, { fields: [mantRecords.vehicleId], references: [fuelVehicles.id] }),
  worksite:         one(worksites, { fields: [mantRecords.worksiteId], references: [worksites.id] }),
  registeredByUser: one(users, { fields: [mantRecords.registeredBy], references: [users.id], relationName: "mant_record_registered_by" }),
  executorUser:     one(users, { fields: [mantRecords.executorUserId], references: [users.id], relationName: "mant_record_executor" }),
  executorWorkshop: one(mantWorkshops, { fields: [mantRecords.executorWorkshopId], references: [mantWorkshops.id] }),
  schedule:         one(mantSchedules, { fields: [mantRecords.scheduleId], references: [mantSchedules.id] }),
  corrective:       one(mantRecordCorrectives, { fields: [mantRecords.id], references: [mantRecordCorrectives.recordId] }),
  items:            many(mantRecordItems),
  parts:            many(mantRecordParts),
  drivers:          many(mantRecordDrivers),
  photos:           many(mantRecordPhotos),
  workshopUpdates:  many(mantWorkshopUpdates),
  observations:     many(mantRecordObservations),
}))

export const mantRecordItemsRelations = relations(mantRecordItems, ({ one }) => ({
  record: one(mantRecords, { fields: [mantRecordItems.recordId], references: [mantRecords.id] }),
}))
export const mantRecordPartsRelations = relations(mantRecordParts, ({ one }) => ({
  record: one(mantRecords, { fields: [mantRecordParts.recordId], references: [mantRecords.id] }),
}))
export const mantRecordDriversRelations = relations(mantRecordDrivers, ({ one }) => ({
  record: one(mantRecords, { fields: [mantRecordDrivers.recordId], references: [mantRecords.id] }),
  driver: one(mantDrivers, { fields: [mantRecordDrivers.driverId], references: [mantDrivers.id] }),
}))
export const mantRecordPhotosRelations = relations(mantRecordPhotos, ({ one }) => ({
  record: one(mantRecords, { fields: [mantRecordPhotos.recordId], references: [mantRecords.id] }),
}))
export const mantWorkshopUpdatesRelations = relations(mantWorkshopUpdates, ({ one }) => ({
  record: one(mantRecords, { fields: [mantWorkshopUpdates.recordId], references: [mantRecords.id] }),
  user:   one(users, { fields: [mantWorkshopUpdates.userId], references: [users.id] }),
}))
export const mantRecordObservationsRelations = relations(mantRecordObservations, ({ one }) => ({
  record: one(mantRecords, { fields: [mantRecordObservations.recordId], references: [mantRecords.id] }),
}))

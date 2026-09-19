import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { users } from "../users"
import { worksites } from "../worksites"

/**
 * Catálogo anual controlado de cursos y campañas. Las ocurrencias son la
 * unidad operativa: un ítem del catálogo, una faena y una posición del
 * cronograma. El modelo no intenta representar asistencia individual.
 */
export const preventionTrainingCatalogItems = pgTable("prevention_training_catalog_items", {
  id:                    text("id").primaryKey(),
  code:                  text("code").notNull(),
  title:                 text("title").notNull(),
  itemType:              text("item_type").notNull(),
  audience:              text("audience").notNull(),
  catalogVersion:        text("catalog_version").notNull(),
  sourceRow:             integer("source_row").notNull(),
  scheduleJson:          jsonb("schedule_json").notNull().default([]),
  pdtpActivityNumbers:   jsonb("pdtp_activity_numbers").notNull().default([]),
  isActive:              boolean("is_active").notNull().default(true),
  sortOrder:             integer("sort_order").notNull(),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_training_catalog_version_code_unique").on(table.catalogVersion, table.code),
  index("prevention_training_catalog_active_order_idx").on(table.catalogVersion, table.isActive, table.sortOrder),
  check("prevention_training_catalog_item_type_check", sql`${table.itemType} IN ('course', 'campaign')`),
  check("prevention_training_catalog_code_check", sql`length(${table.code}) BETWEEN 5 AND 20`),
  check("prevention_training_catalog_title_check", sql`length(${table.title}) BETWEEN 3 AND 500`),
  check("prevention_training_catalog_source_row_check", sql`${table.sourceRow} > 0`),
  check("prevention_training_catalog_sort_order_check", sql`${table.sortOrder} > 0`),
])

export const preventionTrainingOccurrences = pgTable("prevention_training_occurrences", {
  id:                 text("id").primaryKey(),
  catalogItemId:      text("catalog_item_id").notNull(),
  worksiteId:         text("worksite_id").notNull(),
  year:               integer("year").notNull(),
  slotKey:            text("slot_key").notNull(),
  scheduledMonth:     integer("scheduled_month"),
  scheduledWeek:      integer("scheduled_week"),
  status:             text("status").notNull().default("pending"),
  completedAt:        timestamp("completed_at", { withTimezone: true, mode: "string" }),
  completedByUserId:  text("completed_by_user_id"),
  /* El trío de "no aplica", simétrico al de "completed".
   *
   * El molde de `pdtp_scheduled_instances` guarda sólo el motivo y deja el
   * quién/cuándo en metadatos. Acá se guardan los tres porque el CHECK de
   * consistencia de `completed` ya obliga a esa simetría y sostenerla cuesta
   * dos columnas. */
  notApplicableAt:       timestamp("not_applicable_at", { withTimezone: true, mode: "string" }),
  notApplicableByUserId: text("not_applicable_by_user_id"),
  notApplicableReason:   text("not_applicable_reason"),
  observation:        text("observation"),
  version:            integer("version").notNull().default(1),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.catalogItemId], foreignColumns: [preventionTrainingCatalogItems.id], name: "training_occurrence_catalog_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.worksiteId], foreignColumns: [worksites.id], name: "training_occurrence_worksite_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.completedByUserId], foreignColumns: [users.id], name: "training_occurrence_completer_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.notApplicableByUserId], foreignColumns: [users.id], name: "training_occurrence_na_actor_fk" }).onDelete("restrict"),
  uniqueIndex("prevention_training_occurrence_slot_unique").on(table.catalogItemId, table.worksiteId, table.year, table.slotKey),
  index("prevention_training_occurrence_worksite_period_idx").on(table.worksiteId, table.year, table.status),
  index("prevention_training_occurrence_catalog_idx").on(table.catalogItemId, table.year),
  check("prevention_training_occurrence_year_check", sql`${table.year} BETWEEN 2020 AND 2100`),
  check("prevention_training_occurrence_status_check", sql`${table.status} IN ('pending', 'completed', 'not_completed', 'not_applicable')`),
  check("prevention_training_occurrence_slot_check", sql`(${table.scheduledMonth} IS NULL AND ${table.scheduledWeek} IS NULL) OR (${table.scheduledMonth} BETWEEN 1 AND 12 AND ${table.scheduledWeek} BETWEEN 1 AND 4)`),
  check("prevention_training_occurrence_completed_consistency_check", sql`(${table.status} = 'completed' AND ${table.completedAt} IS NOT NULL AND ${table.completedByUserId} IS NOT NULL) OR (${table.status} <> 'completed' AND ${table.completedAt} IS NULL AND ${table.completedByUserId} IS NULL)`),
  /* La rama negativa no es simetría decorativa: sin ella, corregir un "no
   * aplica" a "hecha" deja el motivo colgado, y el export termina mostrando un
   * motivo de no-aplicabilidad junto a una capacitación realizada.
   *
   * El piso del motivo es 10 y no los 3 del molde PDTP: es el mismo que ya
   * exige `excludeActivityForWorksite` para sacar una actividad del denominador,
   * que es exactamente el acto que se está declarando acá. */
  check("prevention_training_occurrence_na_consistency_check", sql`(${table.status} = 'not_applicable' AND ${table.notApplicableAt} IS NOT NULL AND ${table.notApplicableByUserId} IS NOT NULL AND length(trim(COALESCE(${table.notApplicableReason}, ''))) >= 10) OR (${table.status} <> 'not_applicable' AND ${table.notApplicableAt} IS NULL AND ${table.notApplicableByUserId} IS NULL AND ${table.notApplicableReason} IS NULL)`),
  check("prevention_training_occurrence_observation_length_check", sql`${table.observation} IS NULL OR length(${table.observation}) <= 3000`),
  check("prevention_training_occurrence_version_check", sql`${table.version} >= 1`),
])

export const preventionTrainingOccurrenceEvidence = pgTable("prevention_training_occurrence_evidence", {
  id:                text("id").primaryKey(),
  occurrenceId:      text("occurrence_id").notNull(),
  fileName:          text("file_name").notNull(),
  storagePath:       text("storage_path").notNull().unique(),
  mimeType:          text("mime_type").notNull(),
  fileSizeBytes:     integer("file_size_bytes").notNull(),
  sha256:            text("sha256").notNull(),
  state:             text("state").notNull().default("active"),
  uploadedByUserId:  text("uploaded_by_user_id"),
  uploadedAt:        timestamp("uploaded_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  annulledByUserId:  text("annulled_by_user_id"),
  annulledAt:        timestamp("annulled_at", { withTimezone: true, mode: "string" }),
  annulledReason:    text("annulled_reason"),
}, (table) => [
  foreignKey({ columns: [table.occurrenceId], foreignColumns: [preventionTrainingOccurrences.id], name: "training_evidence_occurrence_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.uploadedByUserId], foreignColumns: [users.id], name: "training_evidence_uploader_fk" }).onDelete("set null"),
  foreignKey({ columns: [table.annulledByUserId], foreignColumns: [users.id], name: "training_evidence_annuller_fk" }).onDelete("restrict"),
  index("prevention_training_occurrence_evidence_occurrence_idx").on(table.occurrenceId, table.state, table.uploadedAt),
  check("prevention_training_occurrence_evidence_file_name_check", sql`length(${table.fileName}) BETWEEN 1 AND 255`),
  check("prevention_training_occurrence_evidence_size_check", sql`${table.fileSizeBytes} > 0`),
  check("prevention_training_occurrence_evidence_sha256_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  check("prevention_training_occurrence_evidence_state_check", sql`${table.state} IN ('active', 'replaced', 'annulled')`),
  check("prevention_training_occurrence_evidence_annulled_consistency_check", sql`(${table.state} IN ('active', 'replaced') AND ${table.annulledAt} IS NULL AND ${table.annulledByUserId} IS NULL AND ${table.annulledReason} IS NULL) OR (${table.state} = 'annulled' AND ${table.annulledAt} IS NOT NULL AND ${table.annulledByUserId} IS NOT NULL AND length(${table.annulledReason}) >= 5)`),
])

/* ── Historial inmutable ──────────────────────────────────────────────────
 * La bitácora de cambios de estado de una ocurrencia: qué cambió, por qué y
 * quién. Vivía en `training.ts` junto al modelo por persona y se mudó acá el
 * 2026-09-19, cuando ese archivo se retiró: la escribe
 * `recordTrainingOccurrenceStatus` y es el único registro que queda de un
 * estado anterior, porque la ocurrencia se actualiza en sitio.
 */
export const preventionTrainingHistory = pgTable("prevention_training_history", {
  id:          text("id").primaryKey(),
  entityType:  text("entity_type").notNull(),
  entityId:    text("entity_id").notNull(),
  worksiteId:  text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  changeType:  text("change_type").notNull(),
  reason:      text("reason").notNull(),
  beforeState: jsonb("before_state"),
  afterState:  jsonb("after_state"),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_training_history_entity_idx").on(table.entityType, table.entityId, table.createdAt),
])

export type PreventionTrainingCatalogItem = typeof preventionTrainingCatalogItems.$inferSelect
export type PreventionTrainingOccurrence = typeof preventionTrainingOccurrences.$inferSelect
export type PreventionTrainingOccurrenceEvidence = typeof preventionTrainingOccurrenceEvidence.$inferSelect
export type PreventionTrainingHistory = typeof preventionTrainingHistory.$inferSelect

import { relations, sql } from "drizzle-orm"
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"

/**
 * Fecha de compromiso para una etapa concreta de una entidad operacional. No
 * reemplaza la fecha nativa de solicitudes, ítems u órdenes de compra: la cola
 * toma la que venza antes. Quién la fijó queda en la bitácora de auditoría.
 */
export const workItemAssignments = pgTable("work_item_assignments", {
  id:               text("id").primaryKey(),
  sourceType:       text("source_type").notNull(),
  sourceId:         text("source_id").notNull(),
  actionKey:        text("action_key").notNull(),
  worksiteId:       text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  /** Compromiso adicional; la fecha de origen sigue siendo canónica. */
  committedDueAt:   text("committed_due_at"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("work_item_assignments_source_stage_unique").on(table.sourceType, table.sourceId, table.actionKey),
  index("work_item_assignments_due_idx").on(table.committedDueAt),
  check("work_item_assignments_source_fields_nonempty", sql`length(${table.sourceType}) > 0 AND length(${table.sourceId}) > 0 AND length(${table.actionKey}) > 0`),
])

/**
 * Hechos operacionales emitidos transaccionalmente desde el despliegue de esta
 * capacidad. La carga sólo admite metadatos seguros para la actividad global.
 */
export const operationalActivityEvents = pgTable("operational_activity_events", {
  id:            text("id").primaryKey(),
  eventType:     text("event_type").notNull(),
  module:        text("module").notNull(),
  entityType:    text("entity_type").notNull(),
  entityId:      text("entity_id").notNull(),
  entityCode:    text("entity_code"),
  worksiteId:    text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  actorUserId:   text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorSnapshot: text("actor_snapshot"),
  /** Sólo claves y valores operacionales no sensibles; nunca antecedentes personales. */
  payload:       jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  occurredAt:    timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("operational_activity_events_worksite_occurred_idx").on(table.worksiteId, table.occurredAt),
  index("operational_activity_events_entity_idx").on(table.entityType, table.entityId, table.occurredAt),
  index("operational_activity_events_module_occurred_idx").on(table.module, table.occurredAt),
  check("operational_activity_events_fields_nonempty", sql`length(${table.eventType}) > 0 AND length(${table.module}) > 0 AND length(${table.entityType}) > 0 AND length(${table.entityId}) > 0`),
])

/** Instantánea diaria por faena para comparar backlog sin reconstruir pasado. */
export const operationalMetricSnapshots = pgTable("operational_metric_snapshots", {
  id:           text("id").primaryKey(),
  metric:       text("metric").notNull(),
  worksiteId:   text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  snapshotDate: text("snapshot_date").notNull(),
  value:        text("value").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("operational_metric_snapshot_unique").on(table.metric, table.worksiteId, table.snapshotDate),
  index("operational_metric_snapshot_metric_date_idx").on(table.metric, table.snapshotDate),
  check("operational_metric_snapshots_fields_nonempty", sql`length(${table.metric}) > 0 AND length(${table.snapshotDate}) = 10 AND length(${table.value}) > 0`),
])

export const workItemAssignmentsRelations = relations(workItemAssignments, ({ one }) => ({
  worksite: one(worksites, { fields: [workItemAssignments.worksiteId], references: [worksites.id] }),
}))

export const operationalActivityEventsRelations = relations(operationalActivityEvents, ({ one }) => ({
  worksite: one(worksites, { fields: [operationalActivityEvents.worksiteId], references: [worksites.id] }),
  actor: one(users, { fields: [operationalActivityEvents.actorUserId], references: [users.id] }),
}))

export const operationalMetricSnapshotsRelations = relations(operationalMetricSnapshots, ({ one }) => ({
  worksite: one(worksites, { fields: [operationalMetricSnapshots.worksiteId], references: [worksites.id] }),
}))

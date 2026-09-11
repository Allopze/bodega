import { relations, sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

/** Catálogo canónico de cargos de trabajadores. */
export const workerPositions = pgTable("worker_positions", {
  id:            text("id").primaryKey(),
  code:          text("code").notNull().unique(),
  name:          text("name").notNull(),
  normalizedKey: text("normalized_key").notNull().unique(),
  isActive:      boolean("is_active").notNull().default(true),
  needsReview:   boolean("needs_review").notNull().default(false),
  isSystem:      boolean("is_system").notNull().default(false),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("worker_positions_active_review_idx").on(table.isActive, table.needsReview),
  check("worker_positions_code_valid", sql`length(trim(${table.code})) BETWEEN 2 AND 80`),
  check("worker_positions_name_valid", sql`length(trim(${table.name})) BETWEEN 2 AND 120`),
  check("worker_positions_normalized_key_valid", sql`length(trim(${table.normalizedKey})) BETWEEN 2 AND 120`),
])

/** Sinónimos que se resuelven hacia un cargo canónico. */
export const workerPositionAliases = pgTable("worker_position_aliases", {
  id:            text("id").primaryKey(),
  positionId:    text("position_id").notNull().references(() => workerPositions.id, { onDelete: "restrict" }),
  alias:         text("alias").notNull(),
  normalizedKey: text("normalized_key").notNull(),
  source:        text("source").notNull().default("manual"),
  createdByUserId: text("created_by_user_id"),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("worker_position_aliases_normalized_key_unique").on(table.normalizedKey),
  index("worker_position_aliases_position_idx").on(table.positionId),
  check("worker_position_aliases_alias_valid", sql`length(trim(${table.alias})) BETWEEN 2 AND 120`),
  check("worker_position_aliases_key_valid", sql`length(trim(${table.normalizedKey})) BETWEEN 2 AND 120`),
  check("worker_position_aliases_source_valid", sql`${table.source} IN ('manual', 'import', 'migration', 'merge')`),
])

/** Capacidades operativas reutilizables por Prevención y otros módulos. */
export const workerCapabilities = pgTable("worker_capabilities", {
  id:          text("id").primaryKey(),
  code:        text("code").notNull().unique(),
  name:        text("name").notNull(),
  description: text("description"),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("worker_capabilities_active_idx").on(table.isActive),
  check("worker_capabilities_code_valid", sql`${table.code} ~ '^[a-z][a-z0-9_]{1,79}$'`),
  check("worker_capabilities_name_valid", sql`length(trim(${table.name})) BETWEEN 2 AND 120`),
])

/** Capacidades heredadas por todos los trabajadores de un cargo. */
export const workerPositionCapabilities = pgTable("worker_position_capabilities", {
  positionId:    text("position_id").notNull().references(() => workerPositions.id, { onDelete: "restrict" }),
  capabilityId:  text("capability_id").notNull(),
  createdByUserId: text("created_by_user_id"),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.positionId, table.capabilityId] }),
  // Nombre explícito: el que drizzle deriva pasa de los 63 caracteres que
  // admite Postgres, y la base terminaría con un nombre truncado distinto del
  // que declara el snapshot.
  foreignKey({
    columns: [table.capabilityId],
    foreignColumns: [workerCapabilities.id],
    name: "worker_position_capabilities_capability_id_fk",
  }).onDelete("restrict"),
  index("worker_position_capabilities_capability_idx").on(table.capabilityId, table.positionId),
])

export const workerPositionsRelations = relations(workerPositions, ({ many }) => ({
  aliases:      many(workerPositionAliases),
  capabilities: many(workerPositionCapabilities),
}))

export const workerPositionAliasesRelations = relations(workerPositionAliases, ({ one }) => ({
  position: one(workerPositions, { fields: [workerPositionAliases.positionId], references: [workerPositions.id] }),
}))

export const workerCapabilitiesRelations = relations(workerCapabilities, ({ many }) => ({
  positions: many(workerPositionCapabilities),
}))

export const workerPositionCapabilitiesRelations = relations(workerPositionCapabilities, ({ one }) => ({
  position: one(workerPositions, { fields: [workerPositionCapabilities.positionId], references: [workerPositions.id] }),
  capability: one(workerCapabilities, { fields: [workerPositionCapabilities.capabilityId], references: [workerCapabilities.id] }),
}))

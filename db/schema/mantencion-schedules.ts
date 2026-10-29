import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { mantBrands } from "./mantencion-catalogs"

/*
 * Pautas de mantención preventiva: unidad, intervalos, sistemas (grupos) con
 * ítems y una matriz ítem × intervalo. `version` sube con cada edición; un
 * registro firmado guarda la versión y su propio snapshot de ítems, así que
 * editar la pauta nunca cambia un documento ya firmado.
 *
 * Quitar un intervalo o un ítem lo deja inactivo (nunca se borra): así
 * «Deshacer» lo restituye con su columna intacta, y los registros viejos siguen
 * apuntando a algo que existe.
 */
export const mantSchedules = pgTable("mant_schedules", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),
  nameKey:   text("name_key").notNull(),
  unit:      text("unit").notNull(),
  origin:    text("origin"),
  version:   integer("version").notNull().default(1),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
  deletedBy: text("deleted_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  uniqueIndex("mant_schedules_name_key_live_unique").on(table.nameKey).where(sql`${table.deletedAt} IS NULL`),
  check("mant_schedules_unit_valid", sql`${table.unit} IN ('km', 'h')`),
  check("mant_schedules_version_positive", sql`${table.version} >= 1`),
])

/** Intervalos de la pauta. El menor activo es la base. `needs_review`: nació heredando una columna. */
export const mantScheduleIntervals = pgTable("mant_schedule_intervals", {
  id:          text("id").primaryKey(),
  scheduleId:  text("schedule_id").notNull().references(() => mantSchedules.id, { onDelete: "cascade" }),
  value:       integer("value").notNull(),
  isActive:    boolean("is_active").notNull().default(true),
  needsReview: boolean("needs_review").notNull().default(false),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mant_schedule_intervals_value_unique").on(table.scheduleId, table.value),
  check("mant_schedule_intervals_value_positive", sql`${table.value} > 0`),
])

/** Sistemas de la pauta (Motor, Frenos…), en orden. */
export const mantScheduleGroups = pgTable("mant_schedule_groups", {
  id:         text("id").primaryKey(),
  scheduleId: text("schedule_id").notNull().references(() => mantSchedules.id, { onDelete: "cascade" }),
  name:       text("name").notNull(),
  sortOrder:  integer("sort_order").notNull().default(0),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("mant_schedule_groups_schedule_idx").on(table.scheduleId, table.sortOrder),
])

/**
 * Ítems de un sistema. `item_key` es estable por pauta (`km15`): la regla por
 * marca y el snapshot del registro firmado se cuelgan de ella, no del nombre.
 * `note`: aviso para el editor, p. ej. «Por confirmar» (§19-1).
 */
export const mantScheduleItems = pgTable("mant_schedule_items", {
  id:         text("id").primaryKey(),
  scheduleId: text("schedule_id").notNull().references(() => mantSchedules.id, { onDelete: "cascade" }),
  groupId:    text("group_id").notNull().references(() => mantScheduleGroups.id, { onDelete: "cascade" }),
  itemKey:    text("item_key").notNull(),
  name:       text("name").notNull(),
  note:       text("note"),
  sortOrder:  integer("sort_order").notNull().default(0),
  isActive:   boolean("is_active").notNull().default(true),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mant_schedule_items_key_unique").on(table.scheduleId, table.itemKey),
  index("mant_schedule_items_group_idx").on(table.groupId, table.sortOrder),
])

/** Matriz: si el ítem aplica en el intervalo. */
export const mantScheduleItemIntervals = pgTable("mant_schedule_item_intervals", {
  itemId:     text("item_id").notNull().references(() => mantScheduleItems.id, { onDelete: "cascade" }),
  intervalId: text("interval_id").notNull().references(() => mantScheduleIntervals.id, { onDelete: "cascade" }),
  applies:    boolean("applies").notNull().default(true),
}, (table) => [
  primaryKey({ columns: [table.itemId, table.intervalId], name: "mant_schedule_item_intervals_pk" }),
  index("mant_schedule_item_intervals_interval_idx").on(table.intervalId),
])

/**
 * Regla por marca: A = aplica, W = revisar («Confirmar con pauta del
 * fabricante»), X = no aplica (se oculta). Una fila de la planilla puede no
 * tener ítem (§19-2: «Diagnóstico electrónico motor»): `item_id` nulo, sin
 * efecto en la app hasta que alguien la asocie.
 */
export const mantScheduleBrandRules = pgTable("mant_schedule_brand_rules", {
  id:            text("id").primaryKey(),
  scheduleId:    text("schedule_id").notNull().references(() => mantSchedules.id, { onDelete: "cascade" }),
  itemId:        text("item_id").references(() => mantScheduleItems.id, { onDelete: "set null" }),
  sheetActivity: text("sheet_activity").notNull(),
  brandId:       text("brand_id").notNull().references(() => mantBrands.id, { onDelete: "restrict" }),
  value:         text("value").notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mant_schedule_brand_rules_unique").on(table.scheduleId, table.sheetActivity, table.brandId),
  index("mant_schedule_brand_rules_item_idx").on(table.itemId),
  check("mant_schedule_brand_rules_value_valid", sql`${table.value} IN ('A', 'W', 'X')`),
])

/**
 * Foto inmutable de cada versión de la pauta, en la misma forma que recibe la
 * app (`MantScheduleSnapshot` de `lib/mantencion/types.ts`). Un borrador
 * conserva la versión con que se empezó aunque la pauta cambie después; el
 * servidor revalida el registro contra ESA versión, no contra la vigente.
 */
export const mantScheduleVersions = pgTable("mant_schedule_versions", {
  scheduleId: text("schedule_id").notNull().references(() => mantSchedules.id, { onDelete: "cascade" }),
  version:    integer("version").notNull(),
  snapshot:   jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  summary:    text("summary").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdBy:  text("created_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  primaryKey({ columns: [table.scheduleId, table.version], name: "mant_schedule_versions_pk" }),
])

export const mantSchedulesRelations = relations(mantSchedules, ({ many }) => ({
  intervals:  many(mantScheduleIntervals),
  groups:     many(mantScheduleGroups),
  items:      many(mantScheduleItems),
  brandRules: many(mantScheduleBrandRules),
  versions:   many(mantScheduleVersions),
}))

export const mantScheduleIntervalsRelations = relations(mantScheduleIntervals, ({ one }) => ({
  schedule: one(mantSchedules, { fields: [mantScheduleIntervals.scheduleId], references: [mantSchedules.id] }),
}))

export const mantScheduleGroupsRelations = relations(mantScheduleGroups, ({ one, many }) => ({
  schedule: one(mantSchedules, { fields: [mantScheduleGroups.scheduleId], references: [mantSchedules.id] }),
  items:    many(mantScheduleItems),
}))

export const mantScheduleItemsRelations = relations(mantScheduleItems, ({ one, many }) => ({
  schedule:  one(mantSchedules, { fields: [mantScheduleItems.scheduleId], references: [mantSchedules.id] }),
  group:     one(mantScheduleGroups, { fields: [mantScheduleItems.groupId], references: [mantScheduleGroups.id] }),
  intervals: many(mantScheduleItemIntervals),
}))

export const mantScheduleItemIntervalsRelations = relations(mantScheduleItemIntervals, ({ one }) => ({
  item:     one(mantScheduleItems, { fields: [mantScheduleItemIntervals.itemId], references: [mantScheduleItems.id] }),
  interval: one(mantScheduleIntervals, { fields: [mantScheduleItemIntervals.intervalId], references: [mantScheduleIntervals.id] }),
}))

export const mantScheduleBrandRulesRelations = relations(mantScheduleBrandRules, ({ one }) => ({
  schedule: one(mantSchedules, { fields: [mantScheduleBrandRules.scheduleId], references: [mantSchedules.id] }),
  item:     one(mantScheduleItems, { fields: [mantScheduleBrandRules.itemId], references: [mantScheduleItems.id] }),
  brand:    one(mantBrands, { fields: [mantScheduleBrandRules.brandId], references: [mantBrands.id] }),
}))

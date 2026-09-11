import { pgTable, text, boolean, timestamp, foreignKey, index, check, uniqueIndex } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { worksiteStock } from "./stock"
import { workerCapabilities, workerPositions } from "./worker-positions"

/* ── Worksites (Faenas) ─────────────────────────────────────────────────── */
export const worksites = pgTable("worksites", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),
  code:      text("code").notNull().unique(),   // e.g. "FN-001"
  address:   text("address"),
  region:    text("region"),
  /**
   * Título del cargo `admin_contrato` en el contrato de esta faena:
   * "Administrador de contrato" o "Supervisor de faena" son la misma persona.
   * Null = usar el nombre por defecto (ver `lib/prevention/admin-contrato-label`).
   */
  adminContratoLabel: text("admin_contrato_label"),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("idx_worksites_active").on(table.isActive).where(sql`${table.isActive} = true`),
])

/* ── Suppliers (Proveedores) ─────────────────────────────────────────────── */
export const suppliers = pgTable("suppliers", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull(),
  rut:         text("rut").unique(),            // Chilean RUT
  businessActivity: text("business_activity"),
  contactName: text("contact_name"),
  email:       text("email"),
  phone:       text("phone"),
  address:     text("address"),
  commune:     text("commune"),
  city:        text("city"),
  paymentTerms: text("payment_terms"),          // "30 días", "contado", etc.
  isActive:    boolean("is_active").notNull().default(true),
  notes:       text("notes"),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

/* ── Workers (Trabajadores — for EPP/delivery tracking) ─────────────────── */
export const workers = pgTable("workers", {
  id:          text("id").primaryKey(),
  rut:         text("rut").unique(),
  firstName:   text("first_name").notNull(),
  lastName:    text("last_name").notNull(),
  /** Compatibilidad temporal: retirar después de migrar todos los lectores. */
  position:       text("position"),
  positionId:     text("position_id").references(() => workerPositions.id, { onDelete: "restrict" }),
  supervisor:     text("supervisor"),              // nombre del supervisor directo
  prevencionista: text("prevencionista"),          // nombre del prevencionista asignado
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  sizeTop:     text("size_top"),
  sizeBottom:  text("size_bottom"),
  sizeShoe:    text("size_shoe"),
  sizeGloves:  text("size_gloves"),
  sizeHelmet:  text("size_helmet"),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("workers_position_idx").on(table.positionId),
  index("workers_worksite_position_active_idx").on(table.worksiteId, table.positionId, table.isActive),
])

/** Excepciones individuales a las capacidades heredadas desde el cargo. */
export const workerCapabilityOverrides = pgTable("worker_capability_overrides", {
  id:              text("id").primaryKey(),
  workerId:        text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  capabilityId:    text("capability_id").notNull(),
  mode:            text("mode").notNull(),
  reason:          text("reason").notNull(),
  // IDs de usuario auditables; la integridad de identidad la resuelve el log
  // de auditoría sin introducir un ciclo users -> worksites -> users.
  createdByUserId: text("created_by_user_id"),
  updatedByUserId: text("updated_by_user_id"),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Nombre explícito: el derivado supera los 63 caracteres de Postgres.
  foreignKey({
    columns: [table.capabilityId],
    foreignColumns: [workerCapabilities.id],
    name: "worker_capability_overrides_capability_id_fk",
  }).onDelete("restrict"),
  uniqueIndex("worker_capability_overrides_worker_capability_unique").on(table.workerId, table.capabilityId),
  index("worker_capability_overrides_capability_idx").on(table.capabilityId, table.mode),
  check("worker_capability_overrides_mode_valid", sql`${table.mode} IN ('include', 'exclude')`),
  check("worker_capability_overrides_reason_valid", sql`length(trim(${table.reason})) BETWEEN 5 AND 1000`),
])

/** Historia inmutable de asignaciones de cargo, incluida la migración inicial. */
export const workerPositionHistory = pgTable("worker_position_history", {
  id:                    text("id").primaryKey(),
  workerId:              text("worker_id").notNull().references(() => workers.id, { onDelete: "restrict" }),
  previousPositionId:    text("previous_position_id"),
  nextPositionId:        text("next_position_id").notNull().references(() => workerPositions.id, { onDelete: "restrict" }),
  previousPositionLabel: text("previous_position_label"),
  nextPositionLabel:     text("next_position_label").notNull(),
  source:                text("source").notNull(),
  reason:                text("reason"),
  changedByUserId:       text("changed_by_user_id"),
  changedAt:             timestamp("changed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Nombre explícito: el derivado supera los 63 caracteres de Postgres.
  foreignKey({
    columns: [table.previousPositionId],
    foreignColumns: [workerPositions.id],
    name: "worker_position_history_previous_position_id_fk",
  }).onDelete("restrict"),
  index("worker_position_history_worker_changed_idx").on(table.workerId, table.changedAt),
  index("worker_position_history_next_position_idx").on(table.nextPositionId, table.changedAt),
  check("worker_position_history_source_valid", sql`${table.source} IN ('migration', 'admin', 'import', 'system')`),
  check("worker_position_history_next_label_valid", sql`length(trim(${table.nextPositionLabel})) BETWEEN 2 AND 120`),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const worksitesRelations = relations(worksites, ({ many }) => ({
  workers: many(workers),
  stock:   many(worksiteStock),
}))

export const workersRelations = relations(workers, ({ one }) => ({
  worksite: one(worksites, { fields: [workers.worksiteId], references: [worksites.id] }),
  positionCatalog: one(workerPositions, { fields: [workers.positionId], references: [workerPositions.id] }),
}))

export const workerCapabilityOverridesRelations = relations(workerCapabilityOverrides, ({ one }) => ({
  worker: one(workers, { fields: [workerCapabilityOverrides.workerId], references: [workers.id] }),
  capability: one(workerCapabilities, { fields: [workerCapabilityOverrides.capabilityId], references: [workerCapabilities.id] }),
}))

export const workerPositionHistoryRelations = relations(workerPositionHistory, ({ one }) => ({
  worker: one(workers, { fields: [workerPositionHistory.workerId], references: [workers.id] }),
  previousPosition: one(workerPositions, {
    fields: [workerPositionHistory.previousPositionId],
    references: [workerPositions.id],
    relationName: "worker_position_history_previous",
  }),
  nextPosition: one(workerPositions, {
    fields: [workerPositionHistory.nextPositionId],
    references: [workerPositions.id],
    relationName: "worker_position_history_next",
  }),
}))

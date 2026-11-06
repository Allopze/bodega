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
  /** Comuna del centro de trabajo: encabezado RE-04 de la MIPER. */
  commune:   text("commune"),
  /**
   * Título del cargo `admin_contrato` en el contrato de esta faena:
   * "Administrador de contrato" o "Supervisor de faena" son la misma persona.
   * Null = usar el nombre por defecto (ver `lib/prevention/admin-contrato-label`).
   */
  adminContratoLabel: text("admin_contrato_label"),
  isActive:  boolean("is_active").notNull().default(true),
  /**
   * Cuándo se cerró la faena (null mientras opera). Lo fija y lo limpia
   * `setWorksiteActive`. El cierre anual del PDTP le exige los meses completos
   * anteriores a esta fecha. Las bajas anteriores a la columna quedan en null:
   * de ellas no se sabe la fecha y no se les exige nada.
   */
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true, mode: "string" }),
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
  /**
   * Sexo registral. Null = sin registrar. Los valores son los de
   * `lib/person-sex.ts` y coinciden con `prevention_incident_people.sex`, que
   * lo copia al vincular al trabajador en un incidente.
   */
  sex:         text("sex"),
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
  check("workers_sex_valid", sql`${table.sex} IS NULL OR ${table.sex} IN ('male', 'female', 'other')`),
])

/**
 * Licencia de conducir del trabajador (2026-11, reemplaza la hoja «Trabajadores»
 * de la planilla de vencimientos). Una por trabajador: al renovarla se
 * sobrescribe y la historia queda en la auditoría (`worker_driver_license`).
 * Tabla aparte —no columnas en `workers`— para no tocar alta, importación ni
 * exportación de trabajadores, y para que la lean sólo quienes tienen
 * `flota:manage_licenses`.
 *
 * `expires_at` es la fecha hasta la que la licencia sirve, prórroga incluida
 * (la planilla trae «Prórroga por 6 meses» en `notes`). Null = sin fecha
 * registrada, que la pantalla trata como algo por resolver.
 */
export const workerDriverLicenses = pgTable("worker_driver_licenses", {
  workerId:        text("worker_id").primaryKey().references(() => workers.id, { onDelete: "restrict" }),
  classes:         text("classes").array().notNull(),
  expiresAt:       text("expires_at"),
  notes:           text("notes"),
  // Sin FK a users: mismo criterio que `worker_capability_overrides` (evita el
  // ciclo users -> worksites -> users); la identidad la resuelve la auditoría.
  updatedByUserId: text("updated_by_user_id"),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("worker_driver_licenses_expires_idx").on(table.expiresAt),
  check("worker_driver_licenses_classes_valid", sql`cardinality(${table.classes}) >= 1 AND ${table.classes} <@ ARRAY['A1','A2','A3','A4','A5','A1_ANTIGUA','A2_ANTIGUA','B','C','D','E','F']::text[]`),
  check("worker_driver_licenses_expires_valid", sql`${table.expiresAt} IS NULL OR ${table.expiresAt} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  check("worker_driver_licenses_notes_valid", sql`${table.notes} IS NULL OR length(${table.notes}) <= 300`),
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
  driverLicense: one(workerDriverLicenses, { fields: [workers.id], references: [workerDriverLicenses.workerId] }),
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

export const workerDriverLicensesRelations = relations(workerDriverLicenses, ({ one }) => ({
  worker: one(workers, { fields: [workerDriverLicenses.workerId], references: [workers.id] }),
}))

import { relations, sql } from "drizzle-orm"
import { check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { workers, worksites } from "../worksites"
import { serviceEquipment } from "../service-equipment"

/* ── Alcotest (G14, DO-48) ─────────────────────────────────────────────────
 * Existió antes (`0011_late_madrox.sql`) y se borró en la poda de
 * 2026-07-02 (`0017_nervous_malice.sql`) por no tener módulo. Se recupera con
 * las mismas columnas de entonces, más `equipment_id`: el alcotómetro ya
 * existe como `service_equipment` (kind = 'alcotest') y su calibración ya se
 * controla ahí, así que el equipo es una FK a ese registro, no una tabla
 * nueva.
 *
 * N°30 y N°31 del PDTP tienen el mismo texto ("Realizar alcotest") y sólo
 * difieren en el responsable declarado (PRF vs Sup/JT): el conector elige el
 * número por el rol de quien registra el control, no por un campo de esta
 * tabla — mismo criterio que la N°64/65 de EPP.
 */
export const alcoholTests = pgTable("alcohol_tests", {
  id:                text("id").primaryKey(),
  worksiteId:        text("worksite_id").notNull().references(() => worksites.id),
  performedByUserId: text("performed_by_user_id").notNull().references(() => users.id),
  /**
   * A quién se le tomó el control, cuando es personal propio. Nullable porque
   * el alcotest se aplica también a terceros que entran a la faena —el chofer
   * de un proveedor no está en `workers`—; en ese caso se nombra en
   * `tested_person_name`. El CHECK exige uno de los dos y prohíbe ambos:
   * mismo patrón que `prevention_committee_attendance` con integrante vs
   * invitado. Un control que no dice a quién se le tomó no es evidencia
   * oponible ante un fiscalizador, así que ninguno de los dos puede faltar.
   */
  testedWorkerId:    text("tested_worker_id").references(() => workers.id),
  testedPersonName:  text("tested_person_name"),
  /** Nullable: no todo alcotómetro está dado de alta como equipo todavía. */
  equipmentId:       text("equipment_id").references(() => serviceEquipment.id),
  shift:             text("shift").notNull(),
  performedAt:       timestamp("performed_at", { withTimezone: true, mode: "string" }).notNull(),
  procedureCode:     text("procedure_code").notNull().default("DO-48"),
  result:            text("result").notNull().default("negativo"),
  evidenceUrl:       text("evidence_url"),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("alcohol_tests_result_valid", sql`${table.result} IN ('negativo', 'positivo')`),
  check("alcohol_tests_subject_valid", sql`(${table.testedWorkerId} IS NOT NULL AND ${table.testedPersonName} IS NULL) OR (${table.testedWorkerId} IS NULL AND length(${table.testedPersonName}) >= 3)`),
  index("alcohol_tests_worksite_performed_at_idx").on(table.worksiteId, table.performedAt),
])

export const alcoholTestsRelations = relations(alcoholTests, ({ one }) => ({
  worksite: one(worksites, { fields: [alcoholTests.worksiteId], references: [worksites.id] }),
  performedBy: one(users, { fields: [alcoholTests.performedByUserId], references: [users.id] }),
  testedWorker: one(workers, { fields: [alcoholTests.testedWorkerId], references: [workers.id] }),
  equipment: one(serviceEquipment, { fields: [alcoholTests.equipmentId], references: [serviceEquipment.id] }),
}))

/**
 * N°32 ("Envío de registros según DO-48") es un acto sobre el *lote* de
 * controles del mes anterior, no sobre cada control — acreditarla por
 * control repetiría el error que ya documentó la N°28 (revisar y cerrar
 * inspecciones una por una en vez de por el conjunto). Entidad propia con su
 * propio período, destinatario y evidencia del envío; su cierre es el hecho
 * que acredita, con un `sourceId` que no se repite por mes.
 */
export const alcoholTestDispatches = pgTable("alcohol_test_dispatches", {
  id:            text("id").primaryKey(),
  worksiteId:    text("worksite_id").notNull().references(() => worksites.id),
  /** Año y mes de los controles reportados (el mes anterior al envío, según DO-48). */
  year:          integer("year").notNull(),
  month:         integer("month").notNull(),
  sentByUserId:  text("sent_by_user_id").notNull().references(() => users.id),
  sentAt:        timestamp("sent_at", { withTimezone: true, mode: "string" }).notNull(),
  recipient:     text("recipient").notNull(),
  evidenceUrl:   text("evidence_url"),
  testCount:     integer("test_count").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("alcohol_test_dispatches_worksite_period_unique").on(table.worksiteId, table.year, table.month),
  check("alcohol_test_dispatches_month_valid", sql`${table.month} BETWEEN 1 AND 12`),
  check("alcohol_test_dispatches_count_valid", sql`${table.testCount} >= 0`),
])

export const alcoholTestDispatchesRelations = relations(alcoholTestDispatches, ({ one }) => ({
  worksite: one(worksites, { fields: [alcoholTestDispatches.worksiteId], references: [worksites.id] }),
  sentBy: one(users, { fields: [alcoholTestDispatches.sentByUserId], references: [users.id] }),
}))

/* ── Casillas del programa ─────────────────────────────────────────────────
 * La casilla es del programa; el control y el envío son del dominio. Se
 * mantienen separados por la misma razón que en simulacros y CGRD: un control
 * extraordinario —una fiscalización sorpresa, un ingreso fuera de turno— existe
 * sin casilla y no cuenta en el denominador, y el cronograma sigue exigiendo su
 * celda aunque nadie haya cargado nada. Sin la casilla, "no se hizo" es
 * indistinguible de "nadie lo cargó".
 *
 * Una sola tabla para los dos tipos y no dos: la casilla de control (N°30/31,
 * 12 celdas) y la de envío (N°32, 11 celdas) tienen forma idéntica y difieren
 * sólo en qué hecho las llena. Dos tablas gemelas obligarían a duplicar el
 * mismo aparato de evidencia, de estados y de pre-generación, que es la clase
 * de duplicación que después se desincroniza en un lado solo.
 */
export const preventionAlcotestSlots = pgTable("prevention_alcotest_slots", {
  id:                    text("id").primaryKey(),
  worksiteId:            text("worksite_id").notNull(),
  year:                  integer("year").notNull(),
  /** `control` = N°30/31 (realizar el alcotest); `envio` = N°32 (DO-48). */
  kind:                  text("kind").notNull(),
  slotKey:               text("slot_key").notNull(),
  scheduledMonth:        integer("scheduled_month").notNull(),
  scheduledWeek:         integer("scheduled_week").notNull(),
  status:                text("status").notNull().default("pending"),
  testId:                text("test_id"),
  dispatchId:            text("dispatch_id"),
  completedAt:           timestamp("completed_at", { withTimezone: true, mode: "string" }),
  completedByUserId:     text("completed_by_user_id"),
  notApplicableAt:       timestamp("not_applicable_at", { withTimezone: true, mode: "string" }),
  notApplicableByUserId: text("not_applicable_by_user_id"),
  notApplicableReason:   text("not_applicable_reason"),
  observation:           text("observation"),
  version:               integer("version").notNull().default(1),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.worksiteId], foreignColumns: [worksites.id], name: "alcotest_slot_worksite_fk" }).onDelete("restrict"),
  /* `restrict` y no `set null`: con `set null`, borrar el control dejaría la
   * casilla cumplida apuntando a nada y el CHECK de consistencia rechazaría el
   * borrado con un error de driver. Es la misma lección que dejaron las
   * casillas de simulacro y CGRD. */
  foreignKey({ columns: [table.testId], foreignColumns: [alcoholTests.id], name: "alcotest_slot_test_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.dispatchId], foreignColumns: [alcoholTestDispatches.id], name: "alcotest_slot_dispatch_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.completedByUserId], foreignColumns: [users.id], name: "alcotest_slot_completer_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.notApplicableByUserId], foreignColumns: [users.id], name: "alcotest_slot_na_actor_fk" }).onDelete("restrict"),
  uniqueIndex("prevention_alcotest_slot_unique").on(table.worksiteId, table.year, table.kind, table.slotKey),
  index("prevention_alcotest_slot_period_idx").on(table.worksiteId, table.year, table.status),
  check("prevention_alcotest_slot_year_check", sql`${table.year} BETWEEN 2020 AND 2100`),
  check("prevention_alcotest_slot_kind_check", sql`${table.kind} IN ('control', 'envio')`),
  check("prevention_alcotest_slot_status_check", sql`${table.status} IN ('pending', 'completed', 'not_completed', 'not_applicable')`),
  check("prevention_alcotest_slot_period_check", sql`${table.scheduledMonth} BETWEEN 1 AND 12 AND ${table.scheduledWeek} BETWEEN 1 AND 4`),
  /* Cada tipo de casilla sólo puede apuntar a su propio hecho. Sin esto, una
   * casilla de envío podría quedar cumplida por un control y el checklist
   * mostraría la N°32 acreditada por algo que no es un envío. */
  check("prevention_alcotest_slot_kind_ref_check", sql`(${table.kind} = 'control' AND ${table.dispatchId} IS NULL) OR (${table.kind} = 'envio' AND ${table.testId} IS NULL)`),
  // Una casilla hecha sin el hecho que la cumple sería una marca sin hecho.
  check("prevention_alcotest_slot_done_check", sql`(${table.status} = 'completed' AND COALESCE(${table.testId}, ${table.dispatchId}) IS NOT NULL AND ${table.completedAt} IS NOT NULL AND ${table.completedByUserId} IS NOT NULL) OR (${table.status} <> 'completed' AND ${table.completedAt} IS NULL AND ${table.completedByUserId} IS NULL)`),
  check("prevention_alcotest_slot_na_check", sql`(${table.status} = 'not_applicable' AND ${table.notApplicableAt} IS NOT NULL AND ${table.notApplicableByUserId} IS NOT NULL AND length(trim(COALESCE(${table.notApplicableReason}, ''))) >= 10) OR (${table.status} <> 'not_applicable' AND ${table.notApplicableAt} IS NULL AND ${table.notApplicableByUserId} IS NULL AND ${table.notApplicableReason} IS NULL)`),
  check("prevention_alcotest_slot_version_check", sql`${table.version} >= 1`),
])

/**
 * Evidencia de la casilla, 1:N con estados, copiando
 * `preventionTrainingOccurrenceEvidence`.
 *
 * Cuelga de la casilla y no del control: lo que el programa pide respaldar es
 * el cumplimiento del mes —la planilla de controles, el correo del envío—, no
 * cada lectura del alcotómetro. Un control extraordinario sigue existiendo sin
 * evidencia, igual que antes.
 */
export const preventionAlcotestSlotEvidence = pgTable("prevention_alcotest_slot_evidence", {
  id:                text("id").primaryKey(),
  slotId:            text("slot_id").notNull(),
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
  foreignKey({ columns: [table.slotId], foreignColumns: [preventionAlcotestSlots.id], name: "alcotest_evidence_slot_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.uploadedByUserId], foreignColumns: [users.id], name: "alcotest_evidence_uploader_fk" }).onDelete("set null"),
  foreignKey({ columns: [table.annulledByUserId], foreignColumns: [users.id], name: "alcotest_evidence_annuller_fk" }).onDelete("restrict"),
  index("prevention_alcotest_slot_evidence_idx").on(table.slotId, table.state, table.uploadedAt),
  check("prevention_alcotest_evidence_name_check", sql`length(${table.fileName}) BETWEEN 1 AND 255`),
  check("prevention_alcotest_evidence_size_check", sql`${table.fileSizeBytes} > 0`),
  check("prevention_alcotest_evidence_sha_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  check("prevention_alcotest_evidence_state_check", sql`${table.state} IN ('active', 'replaced', 'annulled')`),
  check("prevention_alcotest_evidence_annul_check", sql`(${table.state} IN ('active', 'replaced') AND ${table.annulledAt} IS NULL AND ${table.annulledByUserId} IS NULL AND ${table.annulledReason} IS NULL) OR (${table.state} = 'annulled' AND ${table.annulledAt} IS NOT NULL AND ${table.annulledByUserId} IS NOT NULL AND length(${table.annulledReason}) >= 5)`),
])

export const preventionAlcotestSlotsRelations = relations(preventionAlcotestSlots, ({ one, many }) => ({
  worksite: one(worksites, { fields: [preventionAlcotestSlots.worksiteId], references: [worksites.id] }),
  test: one(alcoholTests, { fields: [preventionAlcotestSlots.testId], references: [alcoholTests.id] }),
  dispatch: one(alcoholTestDispatches, { fields: [preventionAlcotestSlots.dispatchId], references: [alcoholTestDispatches.id] }),
  evidence: many(preventionAlcotestSlotEvidence),
}))

export const preventionAlcotestSlotEvidenceRelations = relations(preventionAlcotestSlotEvidence, ({ one }) => ({
  slot: one(preventionAlcotestSlots, { fields: [preventionAlcotestSlotEvidence.slotId], references: [preventionAlcotestSlots.id] }),
}))

export type PreventionAlcotestSlot = typeof preventionAlcotestSlots.$inferSelect
export type PreventionAlcotestSlotEvidence = typeof preventionAlcotestSlotEvidence.$inferSelect

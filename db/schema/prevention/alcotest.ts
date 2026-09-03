import { relations, sql } from "drizzle-orm"
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
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

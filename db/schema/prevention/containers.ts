import { relations, sql } from "drizzle-orm"
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"

/* ── Catálogo de contenedores ─────────────────────────────────────────────
 * Padrón de los contenedores (roll-off / ampliroll) instalados en faena.
 *
 * Existía la inspección —Anexo 14, `inspeccion_contenedores`— pero no el
 * padrón: el contenedor se identificaba escribiendo texto libre en
 * `subjectLabel`, así que nadie podía responder qué inspecciones tenía un
 * contenedor concreto y dos inspectores escribían la misma unidad con dos
 * nombres. Esta tabla es el sujeto real, igual que
 * `preventionEmergencyResources` lo es para los extintores.
 *
 * Es dato maestro de la operación y vive en Administración: Prevención lo
 * consume para inspeccionar, no lo crea.
 */
export const preventionContainers = pgTable("prevention_containers", {
  id:              text("id").primaryKey(),
  worksiteId:      text("worksite_id").notNull().references(() => worksites.id, { onDelete: "restrict" }),
  /* Identidad del activo, no de su emplazamiento: el contenedor se traslada
   * entre faenas, así que el código es único global y no por faena. Con
   * unicidad por faena, mover un contenedor a una faena que ya usa ese código
   * fallaría, y el mismo código nombraría dos activos distintos. */
  code:            text("code").notNull(),
  location:        text("location").notNull(),
  status:          text("status").notNull().default("operational"),
  notes:           text("notes"),
  /* Baja lógica: una ficha inspeccionada es evidencia y no se borra. */
  isActive:        boolean("is_active").notNull().default(true),
  version:         integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_container_code_unique").on(table.code),
  index("prevention_container_worksite_idx").on(table.worksiteId, table.isActive),
  check("prevention_container_status_valid", sql`${table.status} IN ('operational', 'observed', 'out_of_service')`),
  check("prevention_container_version_positive", sql`${table.version} >= 1`),
])

/* ── Relations ────────────────────────────────────────────────────────────── */
export const preventionContainersRelations = relations(preventionContainers, ({ one }) => ({
  worksite: one(worksites, { fields: [preventionContainers.worksiteId], references: [worksites.id] }),
  createdBy: one(users, { fields: [preventionContainers.createdByUserId], references: [users.id] }),
}))

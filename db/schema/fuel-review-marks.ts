import { sql } from "drizzle-orm"
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"

/**
 * Pedidos de revisión sobre una carga («Pedir que la revisen»).
 *
 * Cualquier fila de Cargas (terreno, factura o planilla) puede recibir un
 * pedido con nota; el pedido llega a la bandeja «Por revisar» y alguien lo
 * resuelve con su propia nota. `entityType` + `entityId` es la referencia
 * polimórfica al registro fuente.
 *
 * Hasta el rediseño del 2026-10-31 era un interruptor sin nota que se borraba
 * al desmarcar: no quedaba quién lo resolvió ni cuándo. Ahora el pedido se
 * cierra (`resolved`) o se retira (`withdrawn`) y queda en el historial; sólo
 * puede haber un pedido abierto por carga.
 */
export const fuelReviewMarks = pgTable("fuel_review_marks", {
  id:             text("id").primaryKey(),
  entityType:     text("entity_type").notNull(),
  entityId:       text("entity_id").notNull(),
  /** Faena de la carga, para el alcance de la bandeja sin volver a la tabla fuente. */
  worksiteId:     text("worksite_id").references(() => worksites.id),
  markedBy:       text("marked_by").notNull().references(() => users.id),
  notes:          text("notes"),
  status:         text("status").notNull().default("open"),
  resolvedBy:     text("resolved_by").references(() => users.id),
  resolvedAt:     timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  resolutionNote: text("resolution_note"),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("fuel_review_marks_entity_idx").on(table.entityType, table.entityId),
  index("fuel_review_marks_marked_by_idx").on(table.markedBy),
  index("fuel_review_marks_status_worksite_idx").on(table.status, table.worksiteId),
  uniqueIndex("fuel_review_marks_unique_open").on(table.entityType, table.entityId).where(sql`${table.status} = 'open'`),
  check("fuel_review_marks_status_valid", sql`${table.status} IN ('open', 'resolved', 'withdrawn')`),
])

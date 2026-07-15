import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"

/**
 * Marcas de revisión en la bitácora general de combustibles.
 *
 * Cualquier fila de la bitácora (TAE, facturación o log operacional) puede
 * marcarse para revisión por un usuario. `entityType` + `entityId` es la
 * referencia polimórfica que apunta al registro fuente.
 */
export const fuelReviewMarks = pgTable("fuel_review_marks", {
  id:         text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId:   text("entity_id").notNull(),
  markedBy:   text("marked_by").notNull().references(() => users.id),
  notes:      text("notes"),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("fuel_review_marks_entity_idx").on(table.entityType, table.entityId),
  index("fuel_review_marks_marked_by_idx").on(table.markedBy),
  uniqueIndex("fuel_review_marks_unique_mark").on(table.entityType, table.entityId),
])

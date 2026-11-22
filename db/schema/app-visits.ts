import { pgTable, text, integer, timestamp, date, index, primaryKey } from "drizzle-orm/pg-core"
import { users } from "./users"

/* ── Visitas por app ──────────────────────────────────────────────────────
 * Una fila por persona, app y día civil chileno, con un contador: lo mínimo
 * para saber a qué apps entra cada persona y cuándo, sin guardar qué pantalla,
 * registro o búsqueda miró. Hoy alimenta las apps recientes de cada persona en
 * el lanzador de la barra superior (`last_visit_at`); TI › Apps ya no lo usa
 * para medir el uso por módulo (decisión 2026-11-22).
 */
export const appVisits = pgTable("app_visits", {
  userId:      text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** id del módulo en `modules/registry.ts`. */
  moduleId:    text("module_id").notNull(),
  /** Día civil en Chile (`todayInChile`). */
  day:         date("day", { mode: "string" }).notNull(),
  /** Entradas a la app ese día (el cliente no repite la misma app antes de 30 min). */
  views:       integer("views").notNull().default(1),
  lastVisitAt: timestamp("last_visit_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.moduleId, table.day] }),
  index("app_visits_module_day_idx").on(table.moduleId, table.day),
  index("app_visits_day_idx").on(table.day),
])

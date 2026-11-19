import { pgTable, text, integer, timestamp, date, index, primaryKey } from "drizzle-orm/pg-core"
import { users } from "./users"

/* ── Visitas por app ──────────────────────────────────────────────────────
 * La vista TI › Apps medía el uso sólo con `audit_log`, que registra altas y
 * cambios: una app de consulta (Reportes, Analítica, los Paneles) quedaba en
 * cero aunque se abriera todos los días. Decisión del usuario 2026-11-19:
 * registrar también las visitas.
 *
 * Una fila por persona, app y día civil chileno, con un contador: lo mínimo
 * para saber cuántas personas abren cada app y con qué frecuencia, sin guardar
 * qué pantalla, registro o búsqueda miró. El lanzador de apps de la barra
 * superior usa `last_visit_at` para ofrecer las recientes de cada persona.
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

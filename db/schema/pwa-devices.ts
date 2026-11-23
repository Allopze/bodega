import { sql } from "drizzle-orm"
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"
import { fuelTaePublicLinks } from "./fuel-tae"

/* ── Avisos de las apps del teléfono ───────────────────────────────────────
 * PPA Digital, la app del mecánico y Control TAE funcionan sin señal y guardan
 * lo pendiente en el teléfono: el servidor sólo se enteraba de un problema
 * cuando el envío por fin llegaba. Cada app manda ahora un aviso
 * (`POST /api/pwa/aviso`) al abrirse y tras cada intento de envío, y la vista
 * TI › Apps lo lee (diseño 2026-11-22, `docs/superpowers/specs/`).
 *
 * `pwa_devices` guarda el último estado conocido de cada teléfono por app (una
 * fila por teléfono; los que no avisan hace más de 180 días se purgan al
 * registrarse uno nuevo).
 * Nada del trabajador: el teléfono es un UUID al azar. `user_id` sólo se llena
 * con una credencial válida del mecánico; `tae_link_id`, cuando el hash del
 * token calza con un enlace (aunque esté revocado: eso es lo que TI debe ver).
 */
export const pwaDevices = pgTable("pwa_devices", {
  app:             text("app").notNull(),
  deviceId:        text("device_id").notNull(),
  firstSeenAt:     timestamp("first_seen_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  lastSeenAt:      timestamp("last_seen_at", { withTimezone: true, mode: "string" }).notNull(),
  version:         text("version").notNull(),
  builtAt:         timestamp("built_at", { withTimezone: true, mode: "string" }),
  installed:       boolean("installed").notNull(),
  platform:        text("platform").notNull(),
  pendingCount:    integer("pending_count").notNull().default(0),
  failedCount:     integer("failed_count").notNull().default(0),
  oldestPendingAt: timestamp("oldest_pending_at", { withTimezone: true, mode: "string" }),
  lastAttemptAt:   timestamp("last_attempt_at", { withTimezone: true, mode: "string" }),
  /** Último error de envío; se conserva aunque el aviso siguiente llegue sin error. */
  lastError:       text("last_error"),
  lastErrorAt:     timestamp("last_error_at", { withTimezone: true, mode: "string" }),
  userId:          text("user_id").references(() => users.id, { onDelete: "set null" }),
  worksiteId:      text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  taeLinkId:       text("tae_link_id").references(() => fuelTaePublicLinks.id, { onDelete: "set null" }),
}, (table) => [
  primaryKey({ columns: [table.app, table.deviceId] }),
  index("pwa_devices_app_last_seen_idx").on(table.app, table.lastSeenAt),
  check("pwa_devices_app_valid", sql`${table.app} IN ('ppa', 'mantencion', 'tae')`),
  check("pwa_devices_counts_valid", sql`${table.pendingCount} >= 0 AND ${table.failedCount} >= 0`),
])

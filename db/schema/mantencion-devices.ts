import { sql } from "drizzle-orm"
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"

/**
 * Credencial de dispositivo de la app del mecánico (§9).
 *
 * Se emite con la sesión de la plataforma y sirve **sólo** para sincronizar los
 * registros propios desde ese teléfono o tablet, aunque la sesión del navegador
 * pertenezca a otra persona (tablet compartida) o haya expirado. Dura 30 días,
 * jefatura la revoca desde la plataforma y se guarda sólo su SHA-256: el token
 * en claro existe una sola vez, en la respuesta que lo emite.
 *
 * Un dispositivo que vuelve a pedir credencial para la misma cuenta revoca la
 * anterior: a lo más una vigente por (usuario, dispositivo).
 */
export const mantDeviceCredentials = pgTable("mant_device_credentials", {
  id:         text("id").primaryKey(),
  userId:     text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceId:   text("device_id").notNull(),
  tokenHash:  text("token_hash").notNull(),
  label:      text("label"),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt:  timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
  revokedAt:  timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  revokedBy:  text("revoked_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  uniqueIndex("mant_device_credentials_token_hash_unique").on(table.tokenHash),
  uniqueIndex("mant_device_credentials_live_unique").on(table.userId, table.deviceId).where(sql`${table.revokedAt} IS NULL`),
  index("mant_device_credentials_user_idx").on(table.userId, table.createdAt),
])

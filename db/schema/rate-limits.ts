import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

/**
 * Persistent rate-limit table.
 * Replaces the previous in-memory Map so that limits survive server restarts
 * and work across multiple instances (horizontal scaling).
 *
 * `key` = client IP or user email.
 * `count` = consecutive failed attempts.
 * `lockUntil` = epoch ms until the key is locked (0 = not locked).
 */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  lockUntil: integer("lock_until").notNull().default(0),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
})

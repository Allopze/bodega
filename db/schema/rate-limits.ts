import { pgTable, text, integer, bigint, timestamp } from "drizzle-orm/pg-core"

/**
 * Persistent rate-limit table.
 * Replaces the previous in-memory Map so that limits survive server restarts
 * and work across multiple instances (horizontal scaling).
 *
 * `key` = client IP or user email.
 * `count` = consecutive failed attempts.
 * `lockUntil` = epoch ms until the key is locked (0 = not locked).
 *   Note: epoch ms for 2026+ exceeds int4 range → bigint.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  lockUntil: bigint("lock_until", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

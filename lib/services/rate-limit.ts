/**
 * Persistent rate-limiter backed by PostgreSQL.
 * Replaces the previous in-memory Map so limits survive restarts.
 */
import { db } from "@/db"
import { rateLimits } from "@/db/schema"
import { and, eq, gt, lt, sql } from "drizzle-orm"

const LIMIT_ATTEMPTS = 5
const LOCK_TIME = 15 * 60 * 1000 // 15 minutes

/**
 * Check whether `key` (IP or email) is allowed to attempt login.
 * Returns `{ allowed, waitTimeRemainingMs }`.
 */
export async function checkRateLimit(key: string): Promise<{
  allowed: boolean
  waitTimeRemainingMs: number
}> {
  await pruneExpiredLocks()
  const [row] = await db
    .select()
    .from(rateLimits)
    .where(eq(rateLimits.key, key))
    .limit(1)

  if (!row) return { allowed: true, waitTimeRemainingMs: 0 }

  const now = Date.now()
  if (row.lockUntil > now) {
    return { allowed: false, waitTimeRemainingMs: row.lockUntil - now }
  }

  // Lock expired — reset count so a single new failure doesn't immediately re-lock
  if (row.lockUntil > 0) {
    await db.update(rateLimits).set({ count: 0, lockUntil: 0 }).where(eq(rateLimits.key, key))
  }

  return { allowed: true, waitTimeRemainingMs: 0 }
}

/**
 * Record a failed attempt for `key`.
 *
 * Uses a single atomic INSERT … ON CONFLICT DO UPDATE to avoid the
 * read-then-write race where two concurrent failures both see “no row”
 * and duplicate-key on insert.
 */
export async function recordFailure(key: string): Promise<void> {
  const now = Date.now()
  await db
    .insert(rateLimits)
    .values({
      key,
      count: 1,
      lockUntil: 0,
      updatedAt: new Date(now).toISOString(),
    })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`LEAST(${rateLimits.count} + 1, ${LIMIT_ATTEMPTS})`,
        lockUntil: sql`CASE
          WHEN ${rateLimits.count} + 1 >= ${LIMIT_ATTEMPTS}
          THEN ${now + LOCK_TIME}::bigint
          ELSE 0
        END`,
        updatedAt: new Date(now).toISOString(),
      },
    })
}

/** Clear rate-limit record on successful login. */
export async function recordSuccess(key: string): Promise<void> {
  await db.delete(rateLimits)
    .where(eq(rateLimits.key, key))
}

/**
 * Remove expired locks AND stale unlocked counters.
 *
 * 1. Expired locks: lockUntil > 0 AND lockUntil < now.
 * 2. Stale counters: lockUntil = 0 AND untouched for > LOCK_TIME (abandoned attempts).
 *
 * IMPORTANT: it must NOT touch active in-progress counters (lockUntil = 0, recent).
 * The previous predicate accidentally matched every lockUntil=0 row, wiping the counter.
 */
async function pruneExpiredLocks(): Promise<void> {
  const now = Date.now()
  const cutoff = new Date(now - LOCK_TIME).toISOString()

  // Expired locks (lockUntil passed)
  await db.delete(rateLimits)
    .where(and(gt(rateLimits.lockUntil, 0), lt(rateLimits.lockUntil, now)))

  // Stale counters (no lock, not touched recently) — DB-08: updatedAt is now timestamptz
  await db.delete(rateLimits)
    .where(and(
      eq(rateLimits.lockUntil, 0),
      lt(rateLimits.updatedAt, cutoff),
    ))
}

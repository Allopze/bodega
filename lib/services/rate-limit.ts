/**
 * Persistent rate-limiter backed by PostgreSQL.
 * Replaces the previous in-memory Map so limits survive restarts.
 */
import { db } from "@/db"
import { rateLimits } from "@/db/schema"
import { and, eq, gt, lt } from "drizzle-orm"

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

  return { allowed: true, waitTimeRemainingMs: 0 }
}

/** Record a failed attempt for `key`. */
export async function recordFailure(key: string): Promise<void> {
  const now = Date.now()
  const [row] = await db
    .select()
    .from(rateLimits)
    .where(eq(rateLimits.key, key))
    .limit(1)

  if (row) {
    const newCount = row.count + 1
    const lockUntil = newCount >= LIMIT_ATTEMPTS
      ? now + LOCK_TIME
      : 0
    await db.update(rateLimits)
      .set({ count: newCount, lockUntil, updatedAt: new Date(now).toISOString() })
      .where(eq(rateLimits.key, key))
  } else {
    await db.insert(rateLimits)
      .values({ key, count: 1, lockUntil: 0 })
  }
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

  await db.delete(rateLimits)
    .where(and(gt(rateLimits.lockUntil, 0), lt(rateLimits.lockUntil, now)))

  await db.delete(rateLimits)
    .where(and(
      eq(rateLimits.lockUntil, 0),
      lt(rateLimits.updatedAt, cutoff),
    ))
}

/**
 * Persistent rate-limiter backed by PostgreSQL.
 * Replaces the previous in-memory Map so limits survive restarts.
 */
import { db } from "@/db"
import { rateLimits } from "@/db/schema"
import { eq, lt } from "drizzle-orm"

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
  await cleanupExpired()
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
  await cleanupExpired()
  const [row] = await db
    .select()
    .from(rateLimits)
    .where(eq(rateLimits.key, key))
    .limit(1)

  if (row) {
    const newCount = row.count + 1
    const lockUntil = newCount >= LIMIT_ATTEMPTS
      ? Date.now() + LOCK_TIME
      : 0
    await db.update(rateLimits)
      .set({ count: newCount, lockUntil })
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
 * Remove expired entries to keep the table small.
 * Runs automatically on every check/failure.
 */
async function cleanupExpired(): Promise<void> {
  const threshold = Date.now() - LOCK_TIME
  await db.delete(rateLimits)
    .where(lt(rateLimits.lockUntil, threshold))
}

/**
 * Clean up all expired rate-limit entries. Safe to call from a cron/admin action.
 */
export async function cleanupRateLimits(): Promise<void> {
  const threshold = Date.now() - LOCK_TIME
  await db.delete(rateLimits)
    .where(lt(rateLimits.lockUntil, threshold))
}

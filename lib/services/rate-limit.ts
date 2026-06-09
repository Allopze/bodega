/**
 * Persistent rate-limiter backed by SQLite.
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
export function checkRateLimit(key: string): {
  allowed: boolean
  waitTimeRemainingMs: number
} {
  cleanupExpired()
  const row = db
    .select()
    .from(rateLimits)
    .where(eq(rateLimits.key, key))
    .get()

  if (!row) return { allowed: true, waitTimeRemainingMs: 0 }

  const now = Date.now()
  if (row.lockUntil > now) {
    return { allowed: false, waitTimeRemainingMs: row.lockUntil - now }
  }

  return { allowed: true, waitTimeRemainingMs: 0 }
}

/** Record a failed attempt for `key`. */
export function recordFailure(key: string): void {
  cleanupExpired()
  const row = db
    .select()
    .from(rateLimits)
    .where(eq(rateLimits.key, key))
    .get()

  if (row) {
    const newCount = row.count + 1
    const lockUntil = newCount >= LIMIT_ATTEMPTS
      ? Date.now() + LOCK_TIME
      : 0
    db.update(rateLimits)
      .set({ count: newCount, lockUntil, updatedAt: new Date().toISOString() })
      .where(eq(rateLimits.key, key))
      .run()
  } else {
    db.insert(rateLimits)
      .values({ key, count: 1, lockUntil: 0 })
      .run()
  }
}

/** Clear rate-limit record on successful login. */
export function recordSuccess(key: string): void {
  db.delete(rateLimits)
    .where(eq(rateLimits.key, key))
    .run()
}

/**
 * Remove expired entries to keep the table small.
 * Runs automatically on every check/failure.
 */
function cleanupExpired(): void {
  const threshold = Date.now() - LOCK_TIME
  db.delete(rateLimits)
    .where(lt(rateLimits.lockUntil, threshold))
    .run()
}

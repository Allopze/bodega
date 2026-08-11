import { eq, lt, sql } from "drizzle-orm"
import { db } from "@/db"
import { dtePortalOperationLeases, systemSettings } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import {
  DTE_SETTING_KEYS,
  DTE_SETTINGS_ADVISORY_LOCK,
  DTE_SYNC_START_BARRIER_PAUSED,
  isDtePortalStartBarrierIntentionalPause,
  isDtePortalStartBarrierPaused,
} from "./settings"

export class DtePortalStartsPausedError extends Error {
  readonly code = "DTE_PORTAL_STARTS_PAUSED"

  constructor(readonly barrier: string | undefined = DTE_SYNC_START_BARRIER_PAUSED) {
    super("DTE_PORTAL_STARTS_PAUSED")
    this.name = "DtePortalStartsPausedError"
  }
}

/** A malformed persisted fence must fail closed *and* remain operationally visible. */
export function isIntentionalDtePortalCutoverPause(error: unknown): boolean {
  return error instanceof DtePortalStartsPausedError &&
    isDtePortalStartBarrierIntentionalPause(error.barrier)
}

/**
 * Ensures the controlled cutover has not paused new portal I/O. This is a
 * short transaction and deliberately does not reuse the ordinary purchases
 * syncEnabled switch: sales must only pause during a credential cutover.
 */
export async function assertDtePortalStartsAllowed(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${DTE_SETTINGS_ADVISORY_LOCK}))`)
    const [barrier] = await tx
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, DTE_SETTING_KEYS.syncStartBarrier))
    if (isDtePortalStartBarrierPaused(barrier?.value)) {
      throw new DtePortalStartsPausedError(barrier?.value)
    }
  })
}

/**
 * Acquires a durable, bounded lease for a single request carrying DTE
 * credentials. Conversion waits for these leases rather than trusting a
 * historical sync-row status, so sales XML/PDF and health checks are covered
 * too. The caller's fetch timeout must fit inside `leaseMs`.
 */
export async function withDtePortalOperationLease<T>(
  operation: string,
  leaseMs: number,
  work: () => Promise<T>,
): Promise<T> {
  const id = await acquireDtePortalOperationLease(operation, leaseMs)
  try {
    return await work()
  } finally {
    try {
      await db.delete(dtePortalOperationLeases).where(eq(dtePortalOperationLeases.id, id))
    } catch {
      // A leaked row only delays conversion until its bounded expiry. Do not
      // turn a completed portal request into a user-visible transport error.
      logger.error("[dte-operation-lease] release failed", { code: "DTE_OPERATION_LEASE_RELEASE_FAILED" })
    }
  }
}

async function acquireDtePortalOperationLease(operation: string, leaseMs: number): Promise<string> {
  const id = nanoid()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + Math.max(leaseMs, 1_000)).toISOString()

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${DTE_SETTINGS_ADVISORY_LOCK}))`)
    const [barrier] = await tx
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, DTE_SETTING_KEYS.syncStartBarrier))
    if (isDtePortalStartBarrierPaused(barrier?.value)) {
      throw new DtePortalStartsPausedError(barrier?.value)
    }

    await tx.delete(dtePortalOperationLeases)
      .where(lt(dtePortalOperationLeases.leaseExpiresAt, now.toISOString()))
    await tx.insert(dtePortalOperationLeases).values({
      id,
      operation,
      startedAt: now.toISOString(),
      leaseExpiresAt: expiresAt,
    })
  })

  return id
}

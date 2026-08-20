import { eq, gte, lt, sql } from "drizzle-orm"
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

/**
 * Tope global de requests simultáneas contra el portal. El throttle del cliente
 * (`delayMs`) sólo separa requests de UNA instancia, y cada llamador construye
 * la suya: N sincronizaciones de períodos distintos, o varias descargas, salen
 * al portal a la vez sin ningún freno compartido. La cuenta es de un tercero y
 * un bloqueo deja a la empresa sin libro de compras.
 *
 * ponytail: dos en paralelo alcanza para el uso real (un sync + una descarga);
 * si algún día hace falta más caudal, subir el tope, no quitarlo.
 */
const MAX_CONCURRENT_PORTAL_OPERATIONS = 2
/** Cuánto espera un request por su turno antes de rendirse. */
const LEASE_WAIT_TOTAL_MS = 15_000
const LEASE_WAIT_STEP_MS = 200

export class DtePortalTooManyOperationsError extends Error {
  readonly code = "DTE_PORTAL_TOO_MANY_OPERATIONS"

  constructor() {
    super("DTE_PORTAL_TOO_MANY_OPERATIONS")
    this.name = "DtePortalTooManyOperationsError"
  }
}

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
  const deadline = Date.now() + LEASE_WAIT_TOTAL_MS
  for (;;) {
    const id = await tryAcquireDtePortalOperationLease(operation, leaseMs)
    if (id) return id
    if (Date.now() >= deadline) throw new DtePortalTooManyOperationsError()
    await new Promise((resolve) => setTimeout(resolve, LEASE_WAIT_STEP_MS))
  }
}

/** `null` cuando ya hay `MAX_CONCURRENT_PORTAL_OPERATIONS` leases vivos. */
async function tryAcquireDtePortalOperationLease(operation: string, leaseMs: number): Promise<string | null> {
  const id = nanoid()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + Math.max(leaseMs, 1_000)).toISOString()

  return db.transaction(async (tx) => {
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

    // El conteo va dentro del mismo advisory lock que ya serializa las
    // adquisiciones, así que es exacto: nadie inserta entre el count y el
    // insert.
    const [live] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(dtePortalOperationLeases)
      .where(gte(dtePortalOperationLeases.leaseExpiresAt, now.toISOString()))
    if ((live?.count ?? 0) >= MAX_CONCURRENT_PORTAL_OPERATIONS) return null

    await tx.insert(dtePortalOperationLeases).values({
      id,
      operation,
      startedAt: now.toISOString(),
      leaseExpiresAt: expiresAt,
    })
    return id
  })
}

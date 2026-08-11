import { eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { dteSyncRuns, systemSettings } from "@/db/schema"
import {
  DTE_SETTING_KEYS,
  DTE_SETTINGS_ADVISORY_LOCK,
  isDtePortalStartBarrierIntentionalPause,
  isDtePortalStartBarrierPaused,
} from "./settings"

export interface DteSyncStartClaimInput {
  runId: string
  periodo: string
  codEmp: string
  trigger: "manual" | "cron"
  importerId?: string
  correlationId: string
}

export type DteSyncStartClaim =
  | { allowed: true }
  | { allowed: false; reason: "disabled" | "invalid_barrier" | "active_run" }

/**
 * Fences the transition into portal I/O. The conversion operation and every
 * new DTE run share this short advisory transaction: either the run claims a
 * durable `running` row before conversion pauses starts, or it observes the
 * pause and never reaches the portal with stale configuration.
 */
export async function claimDteSyncStart(input: DteSyncStartClaimInput): Promise<DteSyncStartClaim> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${DTE_SETTINGS_ADVISORY_LOCK}))`)

    const [barrier] = await tx
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, DTE_SETTING_KEYS.syncStartBarrier))

    // An absent row keeps compatibility with an env-only setup. Only the
    // dedicated conversion marker pauses every use of the portal credentials;
    // dte.sync_enabled remains the normal purchases automation switch.
    if (isDtePortalStartBarrierPaused(barrier?.value)) {
      return {
        allowed: false,
        reason: isDtePortalStartBarrierIntentionalPause(barrier?.value)
          ? "disabled"
          : "invalid_barrier",
      }
    }

    // PostgreSQL marca la transacción como abortada después de una violación
    // unique. `ON CONFLICT DO NOTHING` conserva la transacción utilizable y
    // permite clasificar la carrera sin convertirla en un error de servidor.
    const inserted = await tx.insert(dteSyncRuns).values({
        id: input.runId,
        periodo: input.periodo,
        codEmp: input.codEmp,
        trigger: input.trigger,
        importerId: input.importerId,
        correlationId: input.correlationId,
        status: "running",
        startedAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .returning({ id: dteSyncRuns.id })

    return inserted.length > 0
      ? { allowed: true }
      : { allowed: false, reason: "active_run" }
  })
}

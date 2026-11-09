import { desc } from "drizzle-orm"
import { db } from "@/db"
import { fleetGpsSyncRuns } from "@/db/schema"
import { logger } from "@/lib/logger"
import { withCronLock } from "@/lib/services/cron-lock"
import { OnwayClientError } from "./onway-client"
import type { OnwayLiveResult } from "./onway-live-contract"
import { readOnwayConfig } from "./onway-settings"
import { syncOnway } from "./onway-sync"

export type { OnwayLiveResult } from "./onway-live-contract"

/**
 * Refresco de posiciones mientras alguien tiene abierta Monitoreo GPS.
 *
 * La página lo pide cada minuto; aquí se decide si de verdad se consulta el
 * portal de Entel. Cada lectura es sólo el snapshot del mapa (una consulta):
 * el detalle por equipo sigue en el cron cada 5 minutos.
 */

/**
 * Con una corrida (de cualquier origen) que empezó hace menos que esto no se
 * vuelve a consultar el portal: dos personas mirando la página no duplican la
 * carga, y la corrida del cron también cuenta como posición fresca.
 */
export const ONWAY_LIVE_MIN_GAP_MS = 50_000

/**
 * El cron de OnWay corre cada 5 minutos en punto (`*\/5`) y es el único que
 * trae el detalle. Si una lectura en vivo tomara el lock justo antes, el cron
 * se saltaría su turno y el detalle quedaría 10 minutos atrás.
 */
const CRON_PERIOD_MS = 5 * 60_000
export const ONWAY_LIVE_CRON_GUARD_MS = 15_000

/** El lock del cron de OnWay: el portal se navega de a una lectura por vez. */
const ONWAY_LOCK_JOB = "fleet-onway-sync"

export function isNearOnwayCronSlot(now: Date): boolean {
  const untilNextSlot = CRON_PERIOD_MS - (now.getTime() % CRON_PERIOD_MS)
  return untilNextSlot <= ONWAY_LIVE_CRON_GUARD_MS
}

export async function refreshOnwayLive(options: { actorUserId?: string; now?: Date } = {}): Promise<OnwayLiveResult> {
  const now = options.now ?? new Date()
  const config = await readOnwayConfig()
  if (!config.hasCredentials) return { outcome: "disabled", reason: "credentials" }
  if (!config.syncEnabled) return { outcome: "disabled", reason: "sync_disabled" }
  if (isNearOnwayCronSlot(now)) return { outcome: "skipped", reason: "cron_window" }

  const [latest] = await db.select({ startedAt: fleetGpsSyncRuns.startedAt })
    .from(fleetGpsSyncRuns)
    .orderBy(desc(fleetGpsSyncRuns.startedAt))
    .limit(1)
  if (latest && now.getTime() - new Date(latest.startedAt).getTime() < ONWAY_LIVE_MIN_GAP_MS) {
    return { outcome: "skipped", reason: "recent" }
  }

  try {
    const result = await withCronLock(
      ONWAY_LOCK_JOB,
      () => syncOnway({ trigger: "live", positionsOnly: true, actorUserId: options.actorUserId, now }),
      { ledger: false },
    )
    if ("skipped" in result) return { outcome: "skipped", reason: "busy" }
    return { outcome: "synced", observedAt: result.observedAt }
  } catch (error) {
    // `syncOnway` ya dejó la corrida en `failed` con su código en la bitácora.
    const code = error instanceof OnwayClientError ? error.code : "ONWAY_SYNC_FAILED"
    logger.warn("[flota/onway/live]", { code })
    return { outcome: "failed", code }
  }
}

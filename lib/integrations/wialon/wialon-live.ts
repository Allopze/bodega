import { logger } from "@/lib/logger"
import { withCronLock } from "@/lib/services/cron-lock"
import { latestProviderObservedAt } from "@/lib/services/fleet-gps-latest"
import type { GpsLiveResult } from "@/lib/integrations/onway/onway-live-contract"
import { WialonClientError } from "./wialon-client"
import { loadWialonConfig } from "./wialon-settings"
import { refreshWialonPositions, WialonSyncError } from "./wialon-sync"

/**
 * Refresco de posiciones de Wialon mientras alguien tiene abierta Monitoreo GPS.
 *
 * La página lo pide cada 10 s. La lectura es una sola consulta liviana (base,
 * posición y último mensaje), así que el límite no es el costo sino no
 * multiplicarlo: varias personas mirando la página comparten UNA lectura cada
 * ~9 s. El detalle (medidores, vínculos, limpieza de unidades) sigue en el cron
 * de 5 minutos; fuera de la página no se consulta nada en vivo.
 */

/**
 * Separación mínima entre lecturas, compartida entre todos los visitantes: se
 * mide contra la última captura escrita (la del cron también cuenta como
 * fresca). Un poco menos que el intervalo de la página (10 s) para que un
 * visitante solo no se salte una de cada dos por estar justo en el borde.
 */
export const WIALON_LIVE_MIN_GAP_MS = 9_000

/**
 * El cron de Wialon corre en los minutos 2, 7, 12… (`2-59/5` en docker-compose).
 * Una lectura en vivo que justo tenga el lock haría que el cron se saltara su
 * turno y el detalle quedaría 10 minutos atrás. La lectura es corta, así que
 * basta una ventana chica antes de cada turno.
 */
const CRON_PERIOD_MS = 5 * 60_000
const CRON_OFFSET_MS = 2 * 60_000
export const WIALON_LIVE_CRON_GUARD_MS = 5_000

/** El lock del cron de Wialon: la sesión y el inventario se leen de a una corrida por vez. */
const WIALON_LOCK_JOB = "fleet-wialon-sync"

export function isNearWialonCronSlot(now: Date): boolean {
  const untilNextSlot = CRON_PERIOD_MS - ((now.getTime() - CRON_OFFSET_MS) % CRON_PERIOD_MS + CRON_PERIOD_MS) % CRON_PERIOD_MS
  return untilNextSlot <= WIALON_LIVE_CRON_GUARD_MS
}

// Sin filas en la tabla (antes de la primera corrida del cron) la separación
// por captura no frena nada: este respaldo por proceso evita consultar a
// Wialon en cada pedido.
let lastAttemptAt = Number.NEGATIVE_INFINITY

/** Sólo para pruebas. */
export function resetWialonLiveThrottle(): void {
  lastAttemptAt = Number.NEGATIVE_INFINITY
}

function isRecent(latestObservedAt: string | null, now: Date): boolean {
  if (now.getTime() - lastAttemptAt < WIALON_LIVE_MIN_GAP_MS) return true
  return latestObservedAt !== null && now.getTime() - Date.parse(latestObservedAt) < WIALON_LIVE_MIN_GAP_MS
}

export async function refreshWialonLive(options: { now?: Date; fetchImpl?: typeof fetch } = {}): Promise<GpsLiveResult> {
  const now = options.now ?? new Date()
  const config = await loadWialonConfig()
  if (!config.hasCredentials) return { outcome: "disabled", reason: "credentials" }
  if (!config.syncEnabled) return { outcome: "disabled", reason: "sync_disabled" }
  if (isNearWialonCronSlot(now)) return { outcome: "skipped", reason: "cron_window" }

  const before = await latestProviderObservedAt("wialon")
  if (isRecent(before, now)) {
    return { outcome: "skipped", reason: "recent", ...(before ? { observedAt: before } : {}) }
  }

  try {
    const result = await withCronLock(
      WIALON_LOCK_JOB,
      async () => {
        // Dos pedidos pueden haber pasado la revisión de arriba a la vez: la
        // que llega segunda al lock vuelve a mirar antes de consultar.
        const latest = await latestProviderObservedAt("wialon")
        if (isRecent(latest, now)) return { recent: latest }
        lastAttemptAt = now.getTime()
        return { refreshed: await refreshWialonPositions({ now, fetchImpl: options.fetchImpl }) }
      },
      { ledger: false },
    )
    if ("skipped" in result) return { outcome: "skipped", reason: "busy" }
    if ("recent" in result) {
      return { outcome: "skipped", reason: "recent", ...(result.recent ? { observedAt: result.recent } : {}) }
    }
    return { outcome: "synced", observedAt: result.refreshed.observedAt }
  } catch (error) {
    const code = error instanceof WialonClientError || error instanceof WialonSyncError
      ? error.code
      : "WIALON_SYNC_FAILED"
    logger.warn("[flota/wialon/live]", { code })
    return { outcome: "failed", code }
  }
}

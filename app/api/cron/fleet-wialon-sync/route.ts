import { NextRequest, NextResponse } from "next/server"
import { fleetGpsCronContractFor, type FleetGpsCronOutcome } from "@/lib/integrations/fleet-gps/cron-contract"
import { WialonClientError } from "@/lib/integrations/wialon/wialon-client"
import { loadWialonConfig } from "@/lib/integrations/wialon/wialon-settings"
import { hasStalledWialonCronRun, syncWialon, WialonSyncError } from "@/lib/integrations/wialon/wialon-sync"
import { logger } from "@/lib/logger"
import { cronRequestSource, parseCronAllowedSources, verifyCronInternalRequest, verifyCronRequest } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * GET /api/cron/fleet-wialon-sync
 *
 * Refresca la última posición y los medidores de las unidades Wialon. Corre
 * cada 5 minutos, desfasado de OnWay. La sesión de Wialon vive en memoria del
 * proceso; este endpoint no recibe ni devuelve el token.
 */
export async function GET(request: NextRequest) {
  const source = cronRequestSource({
    forwardedFor: request.headers.get("x-forwarded-for"),
    realIp: request.headers.get("x-real-ip"),
  })
  const quota = await consumeFixedWindowLimit(`cron:fleet-wialon:${source ?? "unknown"}`, {
    maxAttempts: 10,
    lockMs: 60_000,
  })
  if (!quota.allowed) return respond("rate_limited")

  const secret = process.env.CRON_SECRET
  const allowedSources = parseCronAllowedSources(process.env.CRON_ALLOWED_SOURCES)
  const enforceSource = process.env.NODE_ENV === "production" || allowedSources.length > 0
  const requestHeaders = {
    authorization: request.headers.get("authorization"),
    forwardedFor: request.headers.get("x-forwarded-for"),
    realIp: request.headers.get("x-real-ip"),
  }
  const authorizedBySource = !!secret && verifyCronRequest(requestHeaders, secret, allowedSources, enforceSource)
  const authorizedInternally = !!secret && verifyCronInternalRequest({
    authorization: requestHeaders.authorization,
    internalSecret: request.headers.get("x-fleet-gps-cron-secret"),
  }, secret, process.env.FLEET_GPS_CRON_INTERNAL_SECRET)
  if (!secret || (!authorizedBySource && !authorizedInternally)) {
    return respond("unauthorized")
  }

  try {
    if (!await isRouteOperational("/flota/monitoreo")) return respond("disabled")

    const config = await loadWialonConfig()
    if (!config.hasCredentials || !config.syncEnabled) {
      return respond("disabled", {
        reason: config.hasCredentials ? "sync deshabilitado" : "sin credenciales",
      })
    }

    const result = await withCronLock("fleet-wialon-sync", () => syncWialon({ trigger: "cron" }))
    if ("skipped" in result) {
      if (await hasStalledWialonCronRun().catch(() => false)) {
        logger.error("[cron/fleet-wialon-sync]", { code: "WIALON_SYNC_STALLED" })
        return respond("failed", { errorCode: "WIALON_SYNC_STALLED" })
      }
      return respond("conflict")
    }
    // `unmatched`, `ambiguous`, `duplicateUnits` y `skippedNoPosition` se
    // informan como contadores: son conciliación pendiente, no una corrida
    // incompleta. Sólo la truncación del inventario deja `warnings`.
    return respond(result.warnings.length > 0 ? "partial" : "success", {
      received: result.unitsReceived,
      matched: result.matched,
      unmatched: result.unmatched,
      ambiguous: result.ambiguous,
      duplicateUnits: result.duplicateUnits,
      removedUnits: result.removedUnits,
      skippedNoPosition: result.skippedNoPosition,
      positions: result.positionsUpserted,
      meters: result.metersSaved,
      observedAt: result.observedAt,
      warnings: result.warnings,
    })
  } catch (error) {
    const code = error instanceof WialonClientError || error instanceof WialonSyncError
      ? error.code
      : "WIALON_SYNC_FAILED"
    logger.error("[cron/fleet-wialon-sync]", { code })
    return respond(code === "WIALON_RATE_LIMITED" ? "partial" : "failed", { errorCode: code })
  }
}

function respond(outcome: FleetGpsCronOutcome, extra?: Record<string, unknown>) {
  const contract = fleetGpsCronContractFor(outcome)
  return NextResponse.json({
    ok: contract.ok,
    outcome: contract.outcome,
    code: contract.code,
    health: contract.health,
    ...extra,
  }, { status: contract.httpStatus })
}

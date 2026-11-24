import { NextRequest, NextResponse } from "next/server"
import { alertOnwayNeedsAttention } from "@/lib/integrations/onway/onway-alerts"
import { OnwayClientError } from "@/lib/integrations/onway/onway-client"
import { onwayCronContractFor, type OnwayCronOutcome } from "@/lib/integrations/onway/onway-cron-contract"
import { readOnwayConfig } from "@/lib/integrations/onway/onway-settings"
import { hasStalledOnwayCronRun, isOnwaySyncCoolingDown, syncOnway } from "@/lib/integrations/onway/onway-sync"
import { logger } from "@/lib/logger"
import { cronRequestSource, parseCronAllowedSources, verifyCronInternalRequest, verifyCronRequest } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { latestProviderObservedAt } from "@/lib/services/fleet-gps-latest"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const source = cronRequestSource({
    forwardedFor: request.headers.get("x-forwarded-for"),
    realIp: request.headers.get("x-real-ip"),
  })
  const quota = await consumeFixedWindowLimit(`cron:fleet-onway:${source ?? "unknown"}`, {
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

  if (!await isRouteOperational("/flota/monitoreo")) return respond("disabled")

  const config = await readOnwayConfig()
  if (!config.hasCredentials || !config.syncEnabled) {
    return respond("disabled", {
      reason: config.hasCredentials ? "sync deshabilitado" : "sin credenciales",
    })
  }

  // Auth0 pidió CAPTCHA en la corrida anterior y todavía nadie lo resolvió:
  // reintentar cada 5 minutos es lo que mantiene el desafío vivo (2 873
  // corridas fallidas seguidas desde el 2026-11-22). Se informa `disabled`
  // —el job no está roto, está esperando a una persona— y no se navega el portal.
  if (await isOnwaySyncCoolingDown().catch(() => false)) {
    logger.warn("[cron/fleet-onway-sync]", { code: "ONWAY_INTERACTIVE_AUTH_COOLDOWN" })
    return respond("disabled", { reason: "verificación interactiva pendiente" })
  }

  try {
    const result = await withCronLock("fleet-onway-sync", () => syncOnway({ trigger: "cron" }))
    if ("skipped" in result) {
      // Una corrida que retiene el lock más de lo razonable es una falla, no
      // un solapamiento: así se escondió el GPS detenido de oct-nov 2026.
      if (await hasStalledOnwayCronRun().catch(() => false)) {
        logger.error("[cron/fleet-onway-sync]", { code: "ONWAY_SYNC_STALLED" })
        return respond("failed", { errorCode: "ONWAY_SYNC_STALLED" })
      }
      return respond("conflict")
    }
    const hasIncompleteData = result.rejected > 0 || result.unmatched > 0 || result.warnings.length > 0
    return respond(hasIncompleteData ? "partial" : "success", {
      received: result.received,
      matched: result.matched,
      rejected: result.rejected,
      unmatched: result.unmatched,
      observedAt: result.observedAt,
      warnings: result.warnings,
    })
  } catch (error) {
    const code = error instanceof OnwayClientError ? error.code : "ONWAY_SYNC_FAILED"
    const interactive = code === "ONWAY_INTERACTIVE_AUTH_REQUIRED"
    logger.error("[cron/fleet-onway-sync]", { code })
    // Avisa a quien puede resolverlo. Sin esto la caída del 2026-11-22 pasó
    // 2 días en silencio: el estado existía, pero sólo se veía abriendo TI ›
    // Integraciones. Se espera (no fire-and-forget) porque la ruta termina acá
    // y `alertOnwayNeedsAttention` no lanza nunca.
    if (error instanceof OnwayClientError) {
      await alertOnwayNeedsAttention({ code: error.code, latestObservedAt: await latestOnwayObservedAt().catch(() => null) })
    }
    return respond(interactive ? "partial" : "failed", { errorCode: code })
  }
}

/** Última captura real de la fuente, para que el aviso diga cuánto lleva detenido. */
async function latestOnwayObservedAt(): Promise<string | null> {
  return latestProviderObservedAt("onway")
}

function respond(outcome: OnwayCronOutcome, extra?: Record<string, unknown>) {
  const contract = onwayCronContractFor(outcome)
  return NextResponse.json({
    ok: contract.ok,
    outcome: contract.outcome,
    code: contract.code,
    health: contract.health,
    ...extra,
  }, { status: contract.httpStatus })
}

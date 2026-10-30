import { NextRequest, NextResponse } from "next/server"
import { cronRequestSource, parseCronAllowedSources, verifyCronInternalRequest, verifyCronRequest } from "@/lib/security/cron-auth"
import { fuelCronContractFor } from "@/lib/combustibles/fuel-cron-contract"
import { VisionLinkClientError } from "@/lib/integrations/visionlink/visionlink-client"
import { readVisionLinkConfig } from "@/lib/integrations/visionlink/visionlink-settings"
import { syncVisionLink } from "@/lib/integrations/visionlink/visionlink-sync"
import { logger } from "@/lib/logger"
import { withCronLock } from "@/lib/services/cron-lock"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const source = cronRequestSource({ forwardedFor: request.headers.get("x-forwarded-for"), realIp: request.headers.get("x-real-ip") })
  const quota = await consumeFixedWindowLimit(`cron:fuel:${source ?? "unknown"}`, { maxAttempts: 10, lockMs: 60_000 })
  if (!quota.allowed) return respond(fuelCronContractFor({ rateLimited: true }))
  const allowedSources = parseCronAllowedSources(process.env.CRON_ALLOWED_SOURCES)
  const enforceSource = process.env.NODE_ENV === "production" || allowedSources.length > 0
  const authorization = request.headers.get("authorization")
  const authorizedBySource = !!secret && verifyCronRequest({
    authorization,
    forwardedFor: request.headers.get("x-forwarded-for"),
    realIp: request.headers.get("x-real-ip"),
  }, secret, allowedSources, enforceSource)
  // El scheduler interno llama a `http://app:3000` sin pasar por el proxy: mismo
  // camino que Copec y Aramco.
  const authorizedInternally = !!secret && verifyCronInternalRequest({
    authorization,
    internalSecret: request.headers.get("x-fuel-cron-secret"),
  }, secret, process.env.FUEL_CRON_INTERNAL_SECRET)
  if (!secret || (!authorizedBySource && !authorizedInternally)) {
    return respond(fuelCronContractFor({ unauthorized: true }))
  }
  if (!await isRouteOperational("/combustibles/control")) {
    return respond(fuelCronContractFor({ disabled: true }))
  }

  // Sin credenciales o apagado no es una falla: la integración no está en uso.
  const config = readVisionLinkConfig()
  if (!config.hasCredentials || !config.syncEnabled) {
    return respond(fuelCronContractFor({ disabled: true }), {
      reason: config.hasCredentials ? "sync deshabilitado" : "sin credenciales",
    })
  }

  try {
    const outcome = await withCronLock("fuel-visionlink-sync", () => syncVisionLink(config))
    if ("skipped" in outcome) {
      logger.warn("[cron/fuel-visionlink-sync] Skipped: otra corrida en curso")
      return respond(fuelCronContractFor({ conflict: true }))
    }
    if (outcome.unmatched.length > 0) {
      logger.warn("[cron/fuel-visionlink-sync] Equipos de VisionLink sin vehículo con esa serie", { unmatched: outcome.unmatched })
    }
    return respond(fuelCronContractFor({ failed: 0, total: 1 }), outcome)
  } catch (error) {
    const code = error instanceof VisionLinkClientError ? error.code : "VISIONLINK_SYNC_FAILED"
    logger.error("[cron/fuel-visionlink-sync] Fatal error", { code })
    return respond(fuelCronContractFor({ failed: 1, total: 1 }), { errorCode: code })
  }
}

function respond(contract: ReturnType<typeof fuelCronContractFor>, extra?: object) {
  return NextResponse.json({
    ok: contract.ok,
    outcome: contract.outcome,
    code: contract.code,
    health: contract.health,
    ...extra,
  }, { status: contract.httpStatus })
}

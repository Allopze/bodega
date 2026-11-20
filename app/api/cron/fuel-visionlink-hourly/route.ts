import { NextRequest, NextResponse } from "next/server"
import { cronRequestSource, parseCronAllowedSources, verifyCronInternalRequest, verifyCronRequest } from "@/lib/security/cron-auth"
import { fuelCronContractFor } from "@/lib/combustibles/fuel-cron-contract"
import { HOURLY_LOOKBACK_DAYS } from "@/lib/fleet/shifts/constants"
import { VisionLinkClientError } from "@/lib/integrations/visionlink/visionlink-client"
import { syncVisionLinkHourly } from "@/lib/integrations/visionlink/visionlink-hourly-sync"
import { loadVisionLinkConfig } from "@/lib/integrations/visionlink/visionlink-settings"
import { logger } from "@/lib/logger"
import { withCronLock } from "@/lib/services/cron-lock"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * Corrida liviana cada hora: sólo los tramos por hora de ayer y hoy (unas 24
 * llamadas), para que los turnos de la tarde y la noche de ayer no queden
 * «Pendiente de datos» hasta la mañana siguiente. La reescritura de 14 días la
 * hace el cron de las 06:00 (`fuel-visionlink-sync`).
 */
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
  // camino que Copec y la corrida diaria de VisionLink.
  const authorizedInternally = !!secret && verifyCronInternalRequest({
    authorization,
    internalSecret: request.headers.get("x-fuel-cron-secret"),
  }, secret, process.env.FUEL_CRON_INTERNAL_SECRET)
  if (!secret || (!authorizedBySource && !authorizedInternally)) {
    return respond(fuelCronContractFor({ unauthorized: true }))
  }
  // Misma ruta que la corrida diaria: un solo interruptor para las dos.
  if (!await isRouteOperational(FUEL_PATHS.fuentes)) {
    return respond(fuelCronContractFor({ disabled: true }))
  }

  // Sin credenciales o apagado no es una falla: la integración no está en uso.
  const config = await loadVisionLinkConfig()
  if (!config.hasCredentials || !config.syncEnabled) {
    return respond(fuelCronContractFor({ disabled: true }), {
      reason: config.hasCredentials ? "sync deshabilitado" : "sin credenciales",
    })
  }

  try {
    const outcome = await withCronLock("fuel-visionlink-hourly", () => syncVisionLinkHourly(config, { lookbackDays: HOURLY_LOOKBACK_DAYS }))
    if ("skipped" in outcome) {
      logger.warn("[cron/fuel-visionlink-hourly] Skipped: otra corrida en curso")
      return respond(fuelCronContractFor({ conflict: true }))
    }
    if (outcome.failedVehicles.length > 0) {
      logger.warn("[cron/fuel-visionlink-hourly] Equipos con falla", { failedVehicles: outcome.failedVehicles })
    }
    return respond(fuelCronContractFor({ failed: outcome.failedVehicles.length, total: outcome.vehicles }), outcome)
  } catch (error) {
    const code = error instanceof VisionLinkClientError ? error.code : "VISIONLINK_HOURLY_SYNC_FAILED"
    logger.error("[cron/fuel-visionlink-hourly] Fatal error", { code })
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

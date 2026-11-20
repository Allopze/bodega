import { NextRequest, NextResponse } from "next/server"
import { cronRequestSource, parseCronAllowedSources, verifyCronInternalRequest, verifyCronRequest } from "@/lib/security/cron-auth"
import { fuelCronContractFor } from "@/lib/combustibles/fuel-cron-contract"
import { VisionLinkClientError } from "@/lib/integrations/visionlink/visionlink-client"
import { loadVisionLinkConfig } from "@/lib/integrations/visionlink/visionlink-settings"
import { syncVisionLinkHourly, type SyncVisionLinkHourlyResult } from "@/lib/integrations/visionlink/visionlink-hourly-sync"
import { syncVisionLink } from "@/lib/integrations/visionlink/visionlink-sync"
import { DAILY_LOOKBACK_DAYS } from "@/lib/fleet/shifts/constants"
import { logger } from "@/lib/logger"
import { withCronLock } from "@/lib/services/cron-lock"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// El paso de tramos por hora reescribe 14 días de cada equipo (unas 120 llamadas): no cabe en 2 minutos.
export const maxDuration = 300

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
    const outcome = await withCronLock("fuel-visionlink-sync", () => syncVisionLink(config))
    if ("skipped" in outcome) {
      logger.warn("[cron/fuel-visionlink-sync] Skipped: otra corrida en curso")
      return respond(fuelCronContractFor({ conflict: true }))
    }
    if (outcome.unmatched.length > 0) {
      logger.warn("[cron/fuel-visionlink-sync] Equipos de VisionLink sin vehículo con esa serie", { unmatched: outcome.unmatched })
    }
    // Los tramos por hora van DESPUÉS del resumen diario y aislados de él: si fallan,
    // el diario ya quedó guardado y su contrato no cambia; el resultado se informa aparte.
    const hourly = await runHourlyStep(config)
    return respond(fuelCronContractFor({ failed: 0, total: 1 }), { ...outcome, hourly })
  } catch (error) {
    const code = error instanceof VisionLinkClientError ? error.code : "VISIONLINK_SYNC_FAILED"
    logger.error("[cron/fuel-visionlink-sync] Fatal error", { code })
    return respond(fuelCronContractFor({ failed: 1, total: 1 }), { errorCode: code })
  }
}

type HourlyStepResult = SyncVisionLinkHourlyResult | { skipped: true } | { errorCode: string }

async function runHourlyStep(config: Awaited<ReturnType<typeof loadVisionLinkConfig>>): Promise<HourlyStepResult> {
  try {
    // Mismo candado que la corrida liviana de cada hora: dos reescrituras del mismo rango a la vez se pisarían.
    const result = await withCronLock("fuel-visionlink-hourly", () => syncVisionLinkHourly(config, { lookbackDays: DAILY_LOOKBACK_DAYS }))
    if ("skipped" in result) {
      logger.warn("[cron/fuel-visionlink-sync] Tramos por hora omitidos: otra corrida en curso")
      return { skipped: true }
    }
    if (result.failedVehicles.length > 0) {
      logger.warn("[cron/fuel-visionlink-sync] Tramos por hora: equipos con falla", { failedVehicles: result.failedVehicles })
    }
    return result
  } catch (error) {
    const errorCode = error instanceof VisionLinkClientError ? error.code : "VISIONLINK_HOURLY_SYNC_FAILED"
    logger.error("[cron/fuel-visionlink-sync] Falló el paso de tramos por hora", { errorCode })
    return { errorCode }
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

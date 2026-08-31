import { NextRequest, NextResponse } from "next/server"
import { cronRequestSource, parseCronAllowedSources, verifyCronRequest } from "@/lib/security/cron-auth"
import { syncCopecReports } from "@/lib/combustibles/copec-sync"
import { copecSyncAvailability } from "@/lib/combustibles/copec-reports"
import { fuelCronContractFor } from "@/lib/combustibles/fuel-cron-contract"
import { logger } from "@/lib/logger"
import { withCronLock } from "@/lib/services/cron-lock"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Techo explícito: puede recorrer varios meses de períodos, cada uno con su
// propia descarga de reportes — sin cota, un corte por timeout deja el
// cursor a medio avanzar sin ninguna señal accionable.
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const source = cronRequestSource({ forwardedFor: request.headers.get("x-forwarded-for"), realIp: request.headers.get("x-real-ip") })
  const quota = await consumeFixedWindowLimit(`cron:fuel:${source ?? "unknown"}`, { maxAttempts: 10, lockMs: 60_000 })
  if (!quota.allowed) return respond(fuelCronContractFor({ rateLimited: true }))
  const allowedSources = parseCronAllowedSources(process.env.CRON_ALLOWED_SOURCES)
  const enforceSource = process.env.NODE_ENV === "production" || allowedSources.length > 0
  if (!secret || !verifyCronRequest({
    authorization: request.headers.get("authorization"),
    forwardedFor: request.headers.get("x-forwarded-for"),
    realIp: request.headers.get("x-real-ip"),
  }, secret ?? "", allowedSources, enforceSource)) {
    return respond(fuelCronContractFor({ unauthorized: true }))
  }
  if (!await isRouteOperational("/combustibles/importar")) {
    return respond(fuelCronContractFor({ disabled: true }))
  }

  // Sin credenciales o con el sync apagado no es una falla: es que nadie lo
  // configuró todavía. Antes `env()` lanzaba dentro de la corrida y la ruta
  // reportaba `failed` todos los días por una integración fuera de uso. Es el
  // mismo criterio que ya aplicaba la ruta de Aramco.
  const availability = copecSyncAvailability()
  if (!availability.hasCredentials || !availability.syncEnabled) {
    return respond(fuelCronContractFor({ disabled: true }), {
      reason: availability.hasCredentials ? "sync deshabilitado" : "sin credenciales",
    })
  }

  try {
    const outcome = await withCronLock("fuel-copec-sync", () => syncCopecReports())
    if ("skipped" in outcome) {
      logger.warn("[cron/fuel-copec-sync] Skipped: otra corrida en curso")
      return respond(fuelCronContractFor({ conflict: true }))
    }
    return respond(fuelCronContractFor({ failed: 0, total: 1 }), outcome)
  } catch (error) {
    logger.error("[cron/fuel-copec-sync] Fatal error", error)
    return respond(fuelCronContractFor({ failed: 1, total: 1 }), { error: error instanceof Error ? error.message : "Copec sync failed" })
  }
}

function respond(contract: ReturnType<typeof fuelCronContractFor>, extra?: Record<string, unknown>) {
  return NextResponse.json({
    ok: contract.ok,
    outcome: contract.outcome,
    code: contract.code,
    health: contract.health,
    ...extra,
  }, { status: contract.httpStatus })
}

import { NextRequest, NextResponse } from "next/server"
import { cronRequestSource, parseCronAllowedSources, verifyCronRequest } from "@/lib/security/cron-auth"
import { syncAramco } from "@/lib/combustibles/aramco-sync"
import { readAramcoConfig } from "@/lib/combustibles/aramco-settings"
import { fuelCronContractFor } from "@/lib/combustibles/fuel-cron-contract"
import { AramcoTwoFactorRequiredError } from "@/lib/combustibles/aramco-client"
import { logger } from "@/lib/logger"
import { withCronLock } from "@/lib/services/cron-lock"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Más holgado que lo que necesita hoy (el histórico completo son 154
// transacciones en una sola llamada), pero el portal es ajeno y una respuesta
// lenta no debería dejar el lote a medio insertar.
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
  // configuró todavía. Reportarlo como error dispararía una alerta diaria por
  // una integración que simplemente no está en uso.
  const config = await readAramcoConfig()
  if (!config.hasCredentials || !config.syncEnabled) {
    return respond(fuelCronContractFor({ disabled: true }), {
      reason: config.hasCredentials ? "sync deshabilitado" : "sin credenciales",
    })
  }

  try {
    const outcome = await withCronLock("fuel-aramco-sync", () => syncAramco())
    if ("skipped" in outcome) {
      logger.warn("[cron/fuel-aramco-sync] Skipped: otra corrida en curso")
      return respond(fuelCronContractFor({ conflict: true }))
    }
    return respond(fuelCronContractFor({ failed: 0, total: 1 }), outcome)
  } catch (error) {
    if (error instanceof AramcoTwoFactorRequiredError) {
      // Distinto de una caída: nadie puede arreglarlo reintentando, hace falta
      // que una persona complete el segundo factor.
      logger.error("[cron/fuel-aramco-sync] Aramco exige segundo factor: se requiere intervención manual")
    } else {
      logger.error("[cron/fuel-aramco-sync] Fatal error", error)
    }
    return respond(fuelCronContractFor({ failed: 1, total: 1 }), {
      error: error instanceof Error ? error.message : "Aramco sync failed",
    })
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

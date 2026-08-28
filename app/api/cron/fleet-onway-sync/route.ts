import { NextRequest, NextResponse } from "next/server"
import { OnwayClientError } from "@/lib/integrations/onway/onway-client"
import { onwayCronContractFor, type OnwayCronOutcome } from "@/lib/integrations/onway/onway-cron-contract"
import { readOnwayConfig } from "@/lib/integrations/onway/onway-settings"
import { syncOnway } from "@/lib/integrations/onway/onway-sync"
import { logger } from "@/lib/logger"
import { cronRequestSource, parseCronAllowedSources, verifyCronRequest } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
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
  if (!secret || !verifyCronRequest({
    authorization: request.headers.get("authorization"),
    forwardedFor: request.headers.get("x-forwarded-for"),
    realIp: request.headers.get("x-real-ip"),
  }, secret, allowedSources, enforceSource)) {
    return respond("unauthorized")
  }

  if (!await isRouteOperational("/flota/monitoreo")) return respond("disabled")

  const config = await readOnwayConfig()
  if (!config.hasCredentials || !config.syncEnabled) {
    return respond("disabled", {
      reason: config.hasCredentials ? "sync deshabilitado" : "sin credenciales",
    })
  }

  try {
    const result = await withCronLock("fleet-onway-sync", () => syncOnway({ trigger: "cron" }))
    if ("skipped" in result) return respond("conflict")
    return respond(result.warnings.length > 0 ? "partial" : "success", {
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
    return respond(interactive ? "partial" : "failed", { errorCode: code })
  }
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

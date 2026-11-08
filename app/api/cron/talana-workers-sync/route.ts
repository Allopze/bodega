import { NextRequest, NextResponse } from "next/server"
import { talanaCronContractFor, type TalanaCronOutcome } from "@/lib/integrations/talana/talana-cron-contract"
import { loadTalanaConfig } from "@/lib/integrations/talana/talana-settings"
import { hasStalledTalanaRun, runTalanaSync, TalanaSyncFailure } from "@/lib/integrations/talana/talana-sync"
import { logger } from "@/lib/logger"
import { cronRequestSource, verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * Sincronización diaria de trabajadores desde Talana (sólo lectura contra
 * Talana). Autentica sólo con `Authorization: Bearer CRON_SECRET`, como los
 * crons de DTE y Chipax: el scheduler interno no tiene IP de proxy ni secreto
 * interno aparte.
 */
export async function GET(request: NextRequest) {
  const source = cronRequestSource({
    forwardedFor: request.headers.get("x-forwarded-for"),
    realIp: request.headers.get("x-real-ip"),
  })
  const quota = await consumeFixedWindowLimit(`cron:talana-workers:${source ?? "unknown"}`, {
    maxAttempts: 10,
    lockMs: 60_000,
  })
  if (!quota.allowed) return respond("rate_limited")

  const secret = process.env.CRON_SECRET
  if (!secret || !verifyCronSecret(request.headers.get("authorization"), secret)) {
    return respond("unauthorized")
  }

  if (!await isRouteOperational("/admin/trabajadores")) return respond("disabled")

  // Lo guardado desde Administración › Sincronización Talana, o el `.env` si
  // nadie guardó nada. El motivo es neutro: ya no depende de una variable.
  const { hasCredentials, mode, token } = await loadTalanaConfig()
  if (!hasCredentials) return respond("disabled", { reason: "sin token" })
  if (mode === "off") {
    return respond("disabled", { reason: "sincronización apagada" })
  }

  try {
    const result = await withCronLock("talana-workers-sync", () =>
      runTalanaSync({ trigger: "cron", mode, token }),
    )
    if ("skipped" in result) {
      // Una corrida que retiene el lock más de lo razonable es una falla, no
      // un solapamiento: sin esto una sincronización colgada pasaría por sana.
      if (await hasStalledTalanaRun().catch(() => false)) {
        logger.error("[cron/talana-workers-sync]", { code: "TALANA_SYNC_STALLED" })
        return respond("failed", { errorCode: "TALANA_SYNC_STALLED" })
      }
      return respond("conflict")
    }
    // `blocked` = el fusible no dejó aplicar nada: es degradación, no éxito.
    return respond(result.status === "success" ? "success" : "partial", {
      runId: result.runId,
      mode: result.mode,
      status: result.status,
      fusibleReason: result.fusibleReason,
      counts: result.counts,
    })
  } catch (error) {
    const code = error instanceof TalanaSyncFailure ? error.code : "TALANA_SYNC_FAILED"
    // Sólo el código: nunca el token ni cuerpos de respuesta de Talana.
    logger.error("[cron/talana-workers-sync]", { code })
    return respond("failed", { errorCode: code })
  }
}

function respond(outcome: TalanaCronOutcome, extra?: Record<string, unknown>) {
  const contract = talanaCronContractFor(outcome)
  return NextResponse.json({
    ok: contract.ok,
    outcome: contract.outcome,
    code: contract.code,
    health: contract.health,
    ...extra,
  }, { status: contract.httpStatus })
}

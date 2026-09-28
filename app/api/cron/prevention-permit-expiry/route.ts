import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { suspendExpiredPermits } from "@/lib/services/prevention-permits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Techo explícito, igual que el resto de los crons de Prevención: sin cota un
// corte por timeout de plataforma deja estado parcial sin señal accionable.
export const maxDuration = 300

/**
 * Suspende los permisos de trabajo vigentes cuya ventana autorizada venció
 * (#18). `suspendExpiredPermits` existía y sólo lo llamaba una prueba: un
 * permiso seguía `active` —habilitando trabajo— horas después de vencer.
 *
 * `outcome` y `code` son el contrato de `scripts/cron-runner.mjs` (PREV-C04).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error("[cron/prevention-permit-expiry] CRON_SECRET is not configured")
    return NextResponse.json({ ok: false, outcome: "failed", code: "PREVENTION_CRON_CONFIGURATION", error: "Cron secret not configured" }, { status: 500 })
  }
  if (!verifyCronSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "PREVENTION_CRON_UNAUTHORIZED", error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await withCronLock("prevention-permit-expiry", () => suspendExpiredPermits())
    if ("skipped" in result && result.skipped === true) return NextResponse.json({ ok: true, outcome: "skipped", code: "PREVENTION_CRON_SKIPPED", reason: result.reason })
    logger.info("[cron/prevention-permit-expiry] completed", result)
    return NextResponse.json({ ok: true, outcome: "success", code: "PREVENTION_CRON_SUCCESS", ...result })
  } catch (error) {
    logger.error("[cron/prevention-permit-expiry] failed", error)
    return NextResponse.json({ ok: false, outcome: "failed", code: "PREVENTION_CRON_FAILED", error: "Internal cron error" }, { status: 503 })
  }
}

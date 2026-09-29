/**
 * GET /api/cron/prevention-cron-staleness
 *
 * PRV-14 (auditoría de production readiness 2026-09-28): avisa cuando un job
 * de Prevención superó su cadencia sin una corrida exitosa (el contenedor cron
 * caído, un CRON_SECRET que no coincide). Corre cada hora.
 */

import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { findStalePreventionCronJobs } from "@/lib/services/cron-staleness"
import { alertPreventionCronStaleness } from "@/lib/services/prevention-ops-alerts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error("[cron/prevention-cron-staleness] CRON_SECRET is not configured")
    return NextResponse.json({ ok: false, outcome: "failed", code: "PREVENTION_CRON_CONFIGURATION", error: "Cron secret not configured" }, { status: 500 })
  }
  if (!verifyCronSecret(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "PREVENTION_CRON_UNAUTHORIZED", error: "Unauthorized" }, { status: 401 })
  }
  try {
    const run = await withCronLock("prevention-cron-staleness", async () => {
      const stale = await findStalePreventionCronJobs()
      await alertPreventionCronStaleness(stale)
      return stale
    })
    if ("skipped" in run) return NextResponse.json({ ok: true, outcome: "skipped", code: "PREVENTION_CRON_SKIPPED", reason: run.reason })
    if (run.length > 0) logger.error("[cron/prevention-cron-staleness] Jobs detenidos", run)
    return NextResponse.json({ ok: true, outcome: "success", code: "PREVENTION_CRON_SUCCESS", stale: run })
  } catch (err) {
    logger.error("[cron/prevention-cron-staleness] Fatal error", err)
    const isProd = process.env.NODE_ENV === "production"
    return NextResponse.json(
      { ok: false, outcome: "failed", code: "PREVENTION_CRON_FAILED", error: isProd ? "Internal cron error" : (err instanceof Error ? err.message : "Unknown error") },
      { status: 503 },
    )
  }
}

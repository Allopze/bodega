/**
 * GET /api/cron/traceability-integrity-scan
 *
 * `TRZ-001` (auditoría 2026-09-14). Conviven dos libros de integridad. El
 * nuevo —`operational_integrity_cases`— cubre stock, recepción y compras, y
 * tiene cron desde el principio. El anterior cubre justamente lo que aquél no
 * mira: entregas por encima de lo recibido en faena y entregas anteriores a la
 * recepción. Ése no tenía cron: su único llamador era el botón «Escanear» del
 * banco de trabajo, y encima recortaba por el alcance de quien lo pulsaba.
 *
 * Sólo observa. Reconocer y verificar siguen exigiendo una persona, igual que
 * en `/api/cron/operational-integrity-scan`, del que esta ruta copia su forma.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/traceability-integrity-scan
 */
import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { safeActionMessage } from "@/lib/action-error"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { scanTraceabilityIntegrityAsSystem } from "@/lib/services/traceability-integrity-cases"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const JOB = "traceability-integrity-scan"

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error(`[cron/${JOB}] CRON_SECRET no está configurado`)
    return NextResponse.json({ ok: false, outcome: "failed", code: "TRACEABILITY_SCAN_CONFIGURATION" }, { status: 500 })
  }
  if (!verifyCronSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "TRACEABILITY_SCAN_UNAUTHORIZED" }, { status: 401 })
  }

  try {
    const outcome = await withCronLock(JOB, () => scanTraceabilityIntegrityAsSystem())
    if ("skipped" in outcome) {
      logger.warn(`[cron/${JOB}] otra corrida en curso`)
      return NextResponse.json({ ok: true, outcome: "skipped", code: "TRACEABILITY_SCAN_CONFLICT", reason: outcome.reason }, { status: 200 })
    }

    // `findings` es lo detectado y `recordedCount` lo que era evidencia nueva:
    // que difieran es lo normal, un problema que persiste se detecta en cada
    // corrida y se registra una sola vez.
    logger.info(`[cron/${JOB}] completado`, { found: outcome.findings.length, recorded: outcome.recordedCount })
    return NextResponse.json({
      ok: true, outcome: "success", code: "TRACEABILITY_SCAN_SUCCESS",
      found: outcome.findings.length, recorded: outcome.recordedCount,
    })
  } catch (error) {
    logger.error(`[cron/${JOB}] error fatal`, error)
    return NextResponse.json({
      ok: false, outcome: "failed", code: "TRACEABILITY_SCAN_FAILED",
      error: safeActionMessage(error, "No fue posible completar el escaneo de trazabilidad"),
    }, { status: 503 })
  }
}

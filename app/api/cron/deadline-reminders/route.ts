/**
 * GET /api/cron/deadline-reminders
 *
 * Patrón P3 (auditoría 2026-09-14), tres instancias en una corrida:
 * documentos legales del vehículo (`FLO-002`), revisiones de la matriz de
 * riesgos (`MIP-001`) y solicitudes de derechos del titular (`PRI-001`). Los
 * tres tenían fecha de vencimiento y ninguno avisaba: dependían de que alguien
 * abriera la pantalla correcta.
 *
 * Van juntos porque son el mismo trabajo sobre tres tablas; separarlos habría
 * triplicado la configuración del planificador sin ganar nada.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/deadline-reminders
 */
import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { safeActionMessage } from "@/lib/action-error"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { runDeadlineReminders } from "@/lib/services/deadline-reminders"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const JOB = "deadline-reminders"

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error(`[cron/${JOB}] CRON_SECRET no está configurado`)
    return NextResponse.json({ ok: false, outcome: "failed", code: "DEADLINE_REMINDERS_CONFIGURATION" }, { status: 500 })
  }
  if (!verifyCronSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "DEADLINE_REMINDERS_UNAUTHORIZED" }, { status: 401 })
  }

  try {
    const outcome = await withCronLock(JOB, () => runDeadlineReminders())
    if ("skipped" in outcome) {
      logger.warn(`[cron/${JOB}] otra corrida en curso`)
      return NextResponse.json({ ok: true, outcome: "skipped", code: "DEADLINE_REMINDERS_CONFLICT", reason: outcome.reason }, { status: 200 })
    }
    logger.info(`[cron/${JOB}] completado`, outcome)
    return NextResponse.json({ ok: true, outcome: "success", code: "DEADLINE_REMINDERS_SUCCESS", ...outcome })
  } catch (error) {
    logger.error(`[cron/${JOB}] error fatal`, error)
    return NextResponse.json({
      ok: false, outcome: "failed", code: "DEADLINE_REMINDERS_FAILED",
      error: safeActionMessage(error, "No fue posible enviar los recordatorios de plazo"),
    }, { status: 503 })
  }
}

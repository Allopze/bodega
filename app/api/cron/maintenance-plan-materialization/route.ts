/**
 * GET /api/cron/maintenance-plan-materialization
 *
 * `MNT-001` (auditoría 2026-09-14). Convertir un plan preventivo vencido en una
 * orden de trabajo real tenía un único llamador: una Server Action de la
 * pantalla de mantenciones. El programa preventivo dependía de que alguien
 * entrara a pulsar un botón, y como `/api/cron/maintenance-reminders` sólo
 * notifica órdenes **ya creadas**, tampoco había aviso — el silencio se veía
 * exactamente igual que estar al día.
 *
 * Es idempotente por construcción: no crea una segunda OT para el mismo plan y
 * la misma fecha, así que puede correr varias veces al día sin cuidado.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/maintenance-plan-materialization
 */
import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { safeActionMessage } from "@/lib/action-error"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { materializeDueMaintenancePlansAsSystem } from "@/lib/services/maintenance"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const JOB = "maintenance-plan-materialization"

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error(`[cron/${JOB}] CRON_SECRET no está configurado`)
    return NextResponse.json({ ok: false, outcome: "failed", code: "MAINTENANCE_MATERIALIZE_CONFIGURATION" }, { status: 500 })
  }
  if (!verifyCronSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "MAINTENANCE_MATERIALIZE_UNAUTHORIZED" }, { status: 401 })
  }

  try {
    const outcome = await withCronLock(JOB, () => materializeDueMaintenancePlansAsSystem())
    if ("skipped" in outcome) {
      logger.warn(`[cron/${JOB}] otra corrida en curso`)
      return NextResponse.json({ ok: true, outcome: "skipped", code: "MAINTENANCE_MATERIALIZE_CONFLICT", reason: outcome.reason }, { status: 200 })
    }
    logger.info(`[cron/${JOB}] completado`, outcome)
    return NextResponse.json({ ok: true, outcome: "success", code: "MAINTENANCE_MATERIALIZE_SUCCESS", ...outcome })
  } catch (error) {
    logger.error(`[cron/${JOB}] error fatal`, error)
    return NextResponse.json({
      ok: false, outcome: "failed", code: "MAINTENANCE_MATERIALIZE_FAILED",
      error: safeActionMessage(error, "No fue posible materializar los planes preventivos"),
    }, { status: 503 })
  }
}

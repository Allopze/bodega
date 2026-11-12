/**
 * GET /api/cron/mantencion-fotos-huerfanas
 *
 * Recolector de fotos de mantención que nunca llegaron a un registro
 * (`mant_record_photos.record_id` nulo desde hace más de 7 días): borra la fila
 * y su archivo, en lotes. Protegido por CRON_SECRET.
 *
 * Responde con el contrato del runner (`outcome` + `code`, prefijo
 * `MANTENCION_CRON_`) y los conteos de la corrida.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 300
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { purgeOrphanMantencionPhotos } from "@/lib/services/mantencion/photo-gc"

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error("[cron/mantencion-fotos-huerfanas] CRON_SECRET is not configured")
    return NextResponse.json({ ok: false, outcome: "failed", code: "MANTENCION_CRON_CONFIGURATION", error: "Cron secret not configured" }, { status: 500 })
  }
  if (!verifyCronSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "MANTENCION_CRON_UNAUTHORIZED", error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await withCronLock("mantencion-fotos-huerfanas", () => purgeOrphanMantencionPhotos())
    if ("skipped" in result && result.skipped === true) {
      return NextResponse.json({ ok: true, outcome: "skipped", code: "MANTENCION_CRON_SKIPPED", reason: result.reason })
    }
    logger.info("[cron/mantencion-fotos-huerfanas] completed", result)
    return NextResponse.json({ ok: true, outcome: "success", code: "MANTENCION_CRON_SUCCESS", ...result })
  } catch (error) {
    logger.error("[cron/mantencion-fotos-huerfanas] failed", error)
    return NextResponse.json({ ok: false, outcome: "failed", code: "MANTENCION_CRON_FAILED", error: "Internal cron error" }, { status: 503 })
  }
}

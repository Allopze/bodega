/**
 * GET /api/cron/pdtp-weekly-reminders
 *
 * Endpoint protegido por CRON_SECRET para enviar recordatorios semanales
 * del Programa de Trabajo Preventivo SG-SST a los responsables con
 * permiso `prevention:pdtp:manage` por faena.
 *
 * Llamar semanalmente vía cron externo (Vercel cron, GitHub Actions, etc.):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain/api/cron/pdtp-weekly-reminders
 */

import { type NextRequest, NextResponse } from "next/server"
import { runPdtpWeeklyReminders } from "@/lib/services/prevention-pdtp"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get("authorization")

  if (!secret) {
    logger.error("[cron/pdtp-weekly-reminders] CRON_SECRET is not configured")
    return NextResponse.json({ error: "Cron secret not configured" }, { status: 500 })
  }

  if (!verifyCronSecret(authHeader, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await runPdtpWeeklyReminders()
    logger.info("[cron/pdtp-weekly-reminders] Completed", result)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    logger.error("[cron/pdtp-weekly-reminders] Fatal error", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}

/**
 * GET /api/cron/pdtp-weekly-reminders
 *
 * Endpoint protegido por CRON_SECRET para enviar recordatorios semanales
 * del Programa de Trabajo Preventivo SG-SST a los responsables con
 * permiso `prevention:pdtp:execute` por faena.
 *
 * Llamar semanalmente vía cron externo (Vercel cron, GitHub Actions, etc.):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain/api/cron/pdtp-weekly-reminders
 */

import { type NextRequest, NextResponse } from "next/server"
import { runPdtpWeeklyReminders, runPdtpActionPlanVencidasReminders, runPdtpObligationReminders, runPdtpSignaturePendingReminders } from "@/lib/services/prevention-pdtp"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Techo explícito: estos jobs recorren tablas que crecen y sin cota un
// corte por timeout de plataforma deja estado parcial sin señal accionable.
export const maxDuration = 300

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
    // Un solo lock para los cuatro: corren encadenados en el mismo request, así
    // que solapar la corrida solaparía los cuatro a la vez.
    const chained = await withCronLock("pdtp-weekly-reminders", async () => ({
      result: await runPdtpWeeklyReminders(),
      vencidas: await runPdtpActionPlanVencidasReminders(),
      obligations: await runPdtpObligationReminders(),
      // Actos segregados esperando una firma que nadie dio: es el modo de falla
      // de la N°35, la N°43, la N°80 y la N°83, y hasta ahora era silencioso.
      signatures: await runPdtpSignaturePendingReminders(),
    }))
    if ("skipped" in chained) return NextResponse.json({ ok: true, ...chained })
    const { result, vencidas, obligations, signatures } = chained
    logger.info("[cron/pdtp-weekly-reminders] Completed", { ...result, vencidas, obligations, signatures })
    return NextResponse.json({ ok: true, ...result, vencidas, obligations, signatures })
  } catch (err) {
    // H-B11: en producción, no exponer err.message al cliente porque
    // puede filtrar paths internos, queries SQL, etc. Loguear el
    // detalle y devolver un mensaje genérico. En desarrollo (NODE_ENV
    // !== "production") sí exponerlo para debug.
    logger.error("[cron/pdtp-weekly-reminders] Fatal error", err)
    const isProd = process.env.NODE_ENV === "production"
    return NextResponse.json(
      { error: isProd ? "Internal cron error" : (err instanceof Error ? err.message : "Unknown error") },
      { status: 500 },
    )
  }
}

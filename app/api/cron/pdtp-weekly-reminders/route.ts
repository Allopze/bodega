/**
 * GET /api/cron/pdtp-weekly-reminders
 *
 * Endpoint protegido por CRON_SECRET para enviar recordatorios semanales
 * del Programa de Trabajo Preventivo SG-SST a los responsables con
 * permiso `prevention:pdtp:execute` por faena.
 *
 * Lo agenda el servicio `cron` de docker-compose.yml vía
 * `scripts/cron-runner.mjs` (PREV-C04), cuyo contrato exige `outcome` y `code`
 * en cada respuesta: sin ellos el runner daba por rota una corrida buena.
 */

import { type NextRequest, NextResponse } from "next/server"
import { runPdtpWeeklyReminders, runPdtpActionPlanVencidasReminders, runPdtpObligationReminders, runPdtpSignaturePendingReminders, runPdtpYearCloseReminders } from "@/lib/services/prevention-pdtp"
import { runPdtpScheduledInstanceReminders } from "@/lib/services/pdtp/scheduled-reminders"
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
    return NextResponse.json({ ok: false, outcome: "failed", code: "PREVENTION_CRON_CONFIGURATION", error: "Cron secret not configured" }, { status: 500 })
  }

  if (!verifyCronSecret(authHeader, secret)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "PREVENTION_CRON_UNAUTHORIZED", error: "Unauthorized" }, { status: 401 })
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
      // PREV-C03.6: el año anterior terminó y sigue abierto; avisa a quien
      // puede cerrarlo qué falta (los recordatorios semanales siguen al año civil).
      yearClose: await runPdtpYearCloseReminders(),
      scheduledReminders: await runPdtpScheduledInstanceReminders(),
      // PRV-14 (auditoría 2026-09-28): la reconciliación del libro (instancias,
      // disparadores, carpetas legales, RIOHS, cumplimiento) pasó al job diario
      // `pdtp-daily-reconcile`, con cada paso independiente.
    }))
    if ("skipped" in chained) return NextResponse.json({ ok: true, outcome: "skipped", code: "PREVENTION_CRON_SKIPPED", reason: chained.reason })
    const { result, vencidas, obligations, signatures, yearClose, scheduledReminders } = chained
    logger.info("[cron/pdtp-weekly-reminders] Completed", { ...result, vencidas, obligations, signatures, yearClose, scheduledReminders })
    return NextResponse.json({ ok: true, outcome: "success", code: "PREVENTION_CRON_SUCCESS", ...result, vencidas, obligations, signatures, yearClose, scheduledReminders })
  } catch (err) {
    // H-B11: en producción, no exponer err.message al cliente porque
    // puede filtrar paths internos, queries SQL, etc. Loguear el
    // detalle y devolver un mensaje genérico. En desarrollo (NODE_ENV
    // !== "production") sí exponerlo para debug.
    logger.error("[cron/pdtp-weekly-reminders] Fatal error", err)
    const isProd = process.env.NODE_ENV === "production"
    return NextResponse.json(
      { ok: false, outcome: "failed", code: "PREVENTION_CRON_FAILED", error: isProd ? "Internal cron error" : (err instanceof Error ? err.message : "Unknown error") },
      { status: 503 },
    )
  }
}

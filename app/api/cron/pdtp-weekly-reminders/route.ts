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
import { reconcilePdtpFulfillmentEvents } from "@/lib/services/pdtp/fulfillment"
import { reconcilePdtpScheduledInstances } from "@/lib/services/pdtp/scheduled-instances"
import { reconcilePdtpTriggerEvents } from "@/lib/services/pdtp/trigger-events"
import { runPdtpScheduledInstanceReminders } from "@/lib/services/pdtp/scheduled-reminders"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { sweepPdtpLegalFolders } from "@/lib/services/pdtp-adapters/legal-folder-connector"
import { reconcilePdtpRiohsRollouts } from "@/lib/services/pdtp-adapters/riohs-rollout-connector"

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
      // Las ocurrencias se generan al activar y se reconcilian acá para cubrir
      // nuevas faenas o una corrida interrumpida. Las claves únicas hacen que
      // repetir el cron sea seguro.
      scheduledInstances: await reconcilePdtpScheduledInstances({ limit: 100 }),
      triggerEvents: await reconcilePdtpTriggerEvents({ limit: 200 }),
      scheduledReminders: await runPdtpScheduledInstanceReminders(),
      // N°19: acredita el mes en curso de cada carpeta de requisitos legales
      // que está completa aunque nadie haya cargado nada esta semana.
      legalFolders: await sweepPdtpLegalFolders(),
      // N°18: abre la entrega del RIOHS vigente donde falte, asigna a quien se
      // incorporó y cancela la de versiones reemplazadas.
      riohsRollouts: await reconcilePdtpRiohsRollouts(),
      // Retoma lo que quedó en el libro de cumplimiento (`pending`/`error`) sin
      // esperar a la activación de un programa o al script manual del deploy.
      // Candado distinto anidado dentro del de arriba: es seguro porque
      // `withCronLock` (`lib/services/cron-lock.ts`) llama `client.reserve()`
      // en cada invocación, así que el candado anidado corre sobre una
      // SEGUNDA conexión reservada, no la misma — dos claves distintas, cada
      // una con su propia conexión, sin cruce al liberar. El costo real: este
      // cron mantiene dos conexiones del pool reservadas durante toda la
      // corrida en vez de una.
      reconciled: await withCronLock("pdtp-fulfillment-reconcile", () => reconcilePdtpFulfillmentEvents({ limit: 200 })),
    }))
    if ("skipped" in chained) return NextResponse.json({ ok: true, ...chained })
    const { result, vencidas, obligations, signatures, scheduledInstances, triggerEvents, scheduledReminders, legalFolders, riohsRollouts, reconciled } = chained
    logger.info("[cron/pdtp-weekly-reminders] Completed", { ...result, vencidas, obligations, signatures, scheduledInstances, triggerEvents, scheduledReminders, legalFolders, riohsRollouts, reconciled })
    return NextResponse.json({ ok: true, ...result, vencidas, obligations, signatures, scheduledInstances, triggerEvents, scheduledReminders, legalFolders, riohsRollouts, reconciled })
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

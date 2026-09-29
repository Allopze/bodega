/**
 * GET /api/cron/pdtp-daily-reconcile
 *
 * PRV-14 (auditoría de production readiness 2026-09-28): la reconciliación del
 * libro de cumplimiento del PDTP corría una vez por semana, encadenada detrás
 * de los recordatorios: si fallaba un recordatorio, el lunes siguiente seguía
 * sin reconciliarse nada, y un hecho `pending` o `error` podía tardar hasta
 * siete días en contar.
 *
 * Ahora corre a diario y cada paso es independiente: uno que falla no impide
 * los demás, y la corrida termina en `failed` (con aviso vía `withCronLock`)
 * nombrando qué paso falló.
 */

import { type NextRequest, NextResponse } from "next/server"
import { reconcilePdtpFulfillmentEvents } from "@/lib/services/pdtp/fulfillment"
import { reconcilePdtpScheduledInstances } from "@/lib/services/pdtp/scheduled-instances"
import { reconcilePdtpTriggerEvents } from "@/lib/services/pdtp/trigger-events"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { sweepPdtpLegalFolders } from "@/lib/services/pdtp-adapters/legal-folder-connector"
import { reconcilePdtpRiohsRollouts } from "@/lib/services/pdtp-adapters/riohs-rollout-connector"
import { replayDeferredMandanteCoordinations } from "@/lib/services/pdtp-adapters/external-engagement-accreditation-connector"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

type StepResult = { ok: true; result: unknown } | { ok: false; error: string }

const STEPS: Array<[name: string, run: () => Promise<unknown>]> = [
  // Las ocurrencias se generan al activar; acá se cubren faenas nuevas y
  // corridas interrumpidas. Las claves únicas hacen seguro repetirlo.
  ["scheduledInstances", () => reconcilePdtpScheduledInstances({ limit: 100 })],
  ["triggerEvents", () => reconcilePdtpTriggerEvents({ limit: 200 })],
  // N°19: acredita el mes en curso de cada carpeta de requisitos legales completa.
  ["legalFolders", () => sweepPdtpLegalFolders()],
  // N°18: abre la entrega del RIOHS vigente donde falte.
  ["riohsRollouts", () => reconcilePdtpRiohsRollouts()],
  // PRV-22: coordinaciones con el mandante diferidas mientras la N°20 era constancia.
  ["deferredMandanteCoordinations", () => replayDeferredMandanteCoordinations()],
  // Lo que quedó `pending`/`error` en el libro de cumplimiento.
  ["fulfillment", () => withCronLock("pdtp-fulfillment-reconcile", () => reconcilePdtpFulfillmentEvents({ limit: 200 }))],
]

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error("[cron/pdtp-daily-reconcile] CRON_SECRET is not configured")
    return NextResponse.json({ ok: false, outcome: "failed", code: "PREVENTION_CRON_CONFIGURATION", error: "Cron secret not configured" }, { status: 500 })
  }
  if (!verifyCronSecret(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "PREVENTION_CRON_UNAUTHORIZED", error: "Unauthorized" }, { status: 401 })
  }

  const steps: Record<string, StepResult> = {}
  try {
    const run = await withCronLock("pdtp-daily-reconcile", async () => {
      for (const [name, step] of STEPS) {
        try {
          steps[name] = { ok: true, result: await step() }
        } catch (err) {
          logger.error(`[cron/pdtp-daily-reconcile] falló el paso ${name}`, err)
          steps[name] = { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }
      const failed = Object.entries(steps).filter(([, result]) => !result.ok).map(([name]) => name)
      // Lanzar deja la corrida en `failed` y dispara el aviso de Prevención;
      // los pasos que sí corrieron ya dejaron su efecto.
      if (failed.length > 0) throw new Error(`Pasos fallidos: ${failed.join(", ")}`)
      return steps
    })
    if ("skipped" in run) return NextResponse.json({ ok: true, outcome: "skipped", code: "PREVENTION_CRON_SKIPPED", reason: run.reason })
    logger.info("[cron/pdtp-daily-reconcile] Completed", steps)
    return NextResponse.json({ ok: true, outcome: "success", code: "PREVENTION_CRON_SUCCESS", steps })
  } catch (err) {
    logger.error("[cron/pdtp-daily-reconcile] Fatal error", err)
    const isProd = process.env.NODE_ENV === "production"
    return NextResponse.json(
      { ok: false, outcome: "failed", code: "PREVENTION_CRON_FAILED", error: isProd ? "Internal cron error" : (err instanceof Error ? err.message : "Unknown error"), steps: isProd ? undefined : steps },
      { status: 503 },
    )
  }
}

/**
 * GET /api/cron/fuel-anomaly-detection
 *
 * Endpoint protegido por CRON_SECRET que corre las reglas de anomalía batch
 * (sección 11) fuera del request de revisión TAE: rendimiento fuera de capacidad,
 * variación brusca de consumo, consumo en inactividad, evidencia duplicada e
 * ilegible. Las reglas inline (sello repetido, lectura regresiva, etc.) ya se
 * disparan dentro de `reviewTaeSubmission`; esto cubre lo que no tiene un evento
 * puntual que lo dispare. Llamar periódicamente vía cron externo:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain/api/cron/fuel-anomaly-detection
 */

import { type NextRequest, NextResponse } from "next/server"
import { runAllBatchRules } from "@/lib/combustibles/anomaly-detector"
import { syncAnomalyRuleCatalog } from "@/lib/combustibles/anomaly-cases"
import { fuelCronContractFor } from "@/lib/combustibles/fuel-cron-contract"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { isRouteOperational } from "@/lib/services/module-toggles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Techo explícito: 8 reglas batch, algunas con table scans acotados pero sin
// paginación real — sin esto un corte por timeout de plataforma deja
// ejecuciones "running" a medias sin ninguna señal accionable.
export const maxDuration = 300

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error("[cron/fuel-anomaly-detection] CRON_SECRET is not configured")
    return NextResponse.json({ error: "Cron secret not configured" }, { status: 500 })
  }
  if (!verifyCronSecret(req.headers.get("authorization"), secret)) {
    return respond(fuelCronContractFor({ unauthorized: true }))
  }
  if (!await isRouteOperational("/combustibles/anomalias")) {
    return respond(fuelCronContractFor({ disabled: true }))
  }

  try {
    const outcome = await withCronLock("fuel-anomaly-detection", async () => {
      await syncAnomalyRuleCatalog()
      return runAllBatchRules()
    })
    if ("skipped" in outcome) {
      logger.warn("[cron/fuel-anomaly-detection] Skipped: otra corrida en curso")
      return respond(fuelCronContractFor({ conflict: true }))
    }

    // Antes una regla sin detector (no_detector) y una que reventó (failed)
    // volvían el mismo {created:0, skipped:0} — el cron respondía 200 aunque
    // reglas reales fallaran. Ahora el resultado global distingue ambos casos.
    const failed = outcome.filter((r) => r.status === "failed").length
    logger.info("[cron/fuel-anomaly-detection] Completed", { results: outcome })
    return respond(fuelCronContractFor({ failed, total: outcome.length }), { results: outcome })
  } catch (err) {
    logger.error("[cron/fuel-anomaly-detection] Fatal error", err)
    return respond(fuelCronContractFor({ failed: 1, total: 1 }), { error: err instanceof Error ? err.message : "Unknown error" })
  }
}

function respond(contract: ReturnType<typeof fuelCronContractFor>, extra?: Record<string, unknown>) {
  return NextResponse.json({
    ok: contract.ok,
    outcome: contract.outcome,
    code: contract.code,
    health: contract.health,
    ...extra,
  }, { status: contract.httpStatus })
}

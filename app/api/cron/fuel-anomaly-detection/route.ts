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
import { seedAnomalyRulesIfEmpty } from "@/lib/combustibles/anomaly-cases"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { isRouteOperational } from "@/lib/services/module-toggles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error("[cron/fuel-anomaly-detection] CRON_SECRET is not configured")
    return NextResponse.json({ error: "Cron secret not configured" }, { status: 500 })
  }
  if (!verifyCronSecret(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!await isRouteOperational("/combustibles/anomalias")) {
    return NextResponse.json({ error: "Módulo de combustibles inactivo" }, { status: 503 })
  }

  try {
    await seedAnomalyRulesIfEmpty()
    const results = await runAllBatchRules()
    logger.info("[cron/fuel-anomaly-detection] Completed", { results })
    return NextResponse.json({ ok: true, results })
  } catch (err) {
    logger.error("[cron/fuel-anomaly-detection] Fatal error", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 })
  }
}

/**
 * GET /api/cron/operational-integrity-scan
 *
 * Revisión programada del ledger de integridad operacional: kardex, recepciones
 * y conciliación de facturas. Hasta ahora el escaneo sólo existía como botón en
 * la mesa de integridad, así que un descuadre esperaba a que alguien se acordara
 * de mirar; detectado tres semanas tarde ya contaminó los informes de costo del
 * mes.
 *
 * Sólo observa. Reconocer y verificar siguen exigiendo una persona con
 * `warehouse:reconcile_integrity`: este endpoint no cierra casos ni toca stock.
 *
 * Llamar periódicamente vía cron externo:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain/api/cron/operational-integrity-scan
 */

import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { safeActionMessage } from "@/lib/action-error"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { scanOperationalIntegrityAsSystem } from "@/lib/services/operational-integrity"
import { integrityCronContractFor } from "@/lib/services/operational-integrity/cron-contract"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
/**
 * El detector de compras recorre las OC vivas y reconcilia cada una: es el más
 * caro de los tres y crece con el histórico. Sin techo explícito, un corte por
 * timeout de plataforma dejaría la transacción a medias sin ninguna señal.
 */
export const maxDuration = 300

const DOMAINS = ["stock", "receiving", "purchasing"] as const

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error("[cron/operational-integrity-scan] CRON_SECRET is not configured")
    return respond(integrityCronContractFor({ misconfigured: true }), { error: "Cron secret not configured" })
  }
  if (!verifyCronSecret(req.headers.get("authorization"), secret)) {
    return respond(integrityCronContractFor({ unauthorized: true }))
  }
  if (!await isRouteOperational("/bodega/trazabilidad")) {
    return respond(integrityCronContractFor({ disabled: true }))
  }

  try {
    const outcome = await withCronLock("operational-integrity-scan", () =>
      scanOperationalIntegrityAsSystem([...DOMAINS]))

    if ("skipped" in outcome) {
      logger.warn("[cron/operational-integrity-scan] Skipped: otra corrida en curso")
      return respond(integrityCronContractFor({ conflict: true }), { reason: outcome.reason })
    }

    // `found` cuenta lo detectado y `recorded` lo que era evidencia nueva. Que
    // difieran es lo normal: un problema que persiste se detecta en cada corrida
    // y sólo se registra una vez.
    logger.info("[cron/operational-integrity-scan] Completed", outcome)
    return respond(integrityCronContractFor({}), outcome)
  } catch (error) {
    logger.error("[cron/operational-integrity-scan] Fatal error", error)
    return respond(integrityCronContractFor({ failed: true }), {
      error: safeActionMessage(error, "No fue posible completar la revisión de integridad"),
    })
  }
}

function respond(contract: ReturnType<typeof integrityCronContractFor>, extra?: Record<string, unknown>) {
  return NextResponse.json({
    ok: contract.ok,
    outcome: contract.outcome,
    code: contract.code,
    health: contract.health,
    ...extra,
  }, { status: contract.httpStatus })
}

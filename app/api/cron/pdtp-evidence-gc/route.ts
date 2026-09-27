/**
 * GET /api/cron/pdtp-evidence-gc
 *
 * Recolector de archivos huérfanos en `storage/pdtp-evidence/` y en
 * `storage/risk-map/` (MIP-002), protegido por CRON_SECRET.
 *
 * W5-GC (T7a, D13): agendado a diario en `scripts/cron-runner.mjs`, pero en
 * **modo de prueba**: no borra nada salvo que el servicio `app` tenga
 * `PDTP_EVIDENCE_GC_DELETE=true`. Cada corrida con huérfanos deja una fila
 * `storage_orphan_sweep` en `audit_log`; esas filas son lo que se revisa
 * durante una o dos semanas antes de encender el borrado real
 * (docs/deploy/DESPLIEGUE_PREVENCION_2026-09.md).
 *
 * Query params:
 *   - dryRun=true: fuerza el modo de prueba aunque la variable esté encendida.
 *   - olderThanMs=N: ventana de gracia en ms (default y mínimo: 24 h). Un valor
 *     menor responde 400: un upload todavía sin vincular no es un huérfano.
 *
 * Responde con el contrato del runner (`outcome` + `code`, prefijo
 * `PREVENTION_CRON_`) y conteos por directorio con una muestra acotada de
 * nombres: el runner lee como máximo 32 KiB. La lista completa está en la
 * fila de auditoría.
 */
export const dynamic = "force-dynamic"
// Techo explícito: estos jobs recorren tablas que crecen y sin cota un
// corte por timeout de plataforma deja estado parcial sin señal accionable.
export const maxDuration = 300
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import {
  cleanupPdtpEvidenceOrphans,
  cleanupRiskMapOrphans,
  type CleanupPdtpEvidenceOrphansResult,
} from "@/lib/services/pdtp/evidence-gc"
import { MIN_ORPHAN_AGE_LABEL, MIN_ORPHAN_AGE_MS, summarizeOrphanCleanup } from "@/lib/services/pdtp/evidence-gc-policy"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"

/** Borrado real sólo con la variable encendida y sin `?dryRun=true`. */
function resolveDryRun(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get("dryRun") === "true") return true
  return process.env.PDTP_EVIDENCE_GC_DELETE !== "true"
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error("[cron/pdtp-evidence-gc] CRON_SECRET is not configured")
    return NextResponse.json({ ok: false, outcome: "failed", code: "PREVENTION_CRON_CONFIGURATION", error: "Cron secret not configured" }, { status: 500 })
  }
  if (!verifyCronSecret(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "PREVENTION_CRON_UNAUTHORIZED", error: "Unauthorized" }, { status: 401 })
  }

  const dryRun = resolveDryRun(req)
  const olderThanMsParam = req.nextUrl.searchParams.get("olderThanMs")
  const olderThanMs = olderThanMsParam ? Number(olderThanMsParam) : undefined
  if (olderThanMs !== undefined && (!Number.isFinite(olderThanMs) || olderThanMs < MIN_ORPHAN_AGE_MS)) {
    return NextResponse.json(
      { ok: false, outcome: "failed", code: "PREVENTION_CRON_INVALID_REQUEST", error: `olderThanMs inválido: el mínimo es ${MIN_ORPHAN_AGE_MS} (${MIN_ORPHAN_AGE_LABEL}).` },
      { status: 400 },
    )
  }

  try {
    // MIP-002: el directorio de planos de riesgo se barre desde este mismo job
    // —mismo dueño, misma cadencia, mismo secreto—. El resultado se informa por
    // directorio para que un borrado no se confunda con el otro.
    const result = await withCronLock("pdtp-evidence-gc", async () => ({
      pdtpEvidence: await cleanupPdtpEvidenceOrphans({ dryRun, olderThanMs }),
      riskMap: await cleanupRiskMapOrphans({ dryRun, olderThanMs }),
    }))
    if ("skipped" in result && result.skipped === true) {
      return NextResponse.json({ ok: true, outcome: "skipped", code: "PREVENTION_CRON_SKIPPED", reason: result.reason })
    }
    const { pdtpEvidence, riskMap } = result as { pdtpEvidence: CleanupPdtpEvidenceOrphansResult; riskMap: CleanupPdtpEvidenceOrphansResult }
    return NextResponse.json({
      ok: true,
      outcome: "success",
      code: "PREVENTION_CRON_SUCCESS",
      dryRun,
      pdtpEvidence: summarizeOrphanCleanup(pdtpEvidence),
      riskMap: summarizeOrphanCleanup(riskMap),
    })
  } catch (err) {
    logger.error("[cron/pdtp-evidence-gc] failed", err)
    return NextResponse.json({ ok: false, outcome: "failed", code: "PREVENTION_CRON_FAILED", error: "Internal cron error" }, { status: 503 })
  }
}

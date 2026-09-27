/**
 * GET /api/cron/pdtp-evidence-integrity
 *
 * PREV-I13-C: escaneo diario de integridad entre la base y el disco para la
 * evidencia PDTP (`scanPdtpEvidenceIntegrity`). Comprueba que cada archivo
 * referenciado por ejecuciones, plan de acción, historial de envíos o
 * instancias exista y conserve el sha256 con que se vinculó.
 *
 * Sólo observa: no borra ni corrige. Encontrar evidencia perdida no es una
 * falla del cron —el cron funcionó—, así que responde `success` con los
 * conteos; la alerta es el `logger.error` del servicio (D28: sólo logs por
 * ahora). La respuesta lleva conteos y una muestra acotada de rutas: el runner
 * lee como máximo 32 KiB y una lista completa lo rompería justo cuando más
 * importa.
 *
 * `outcome` y `code` son el contrato de `scripts/cron-runner.mjs`.
 */
import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { scanPdtpEvidenceIntegrity, type PdtpEvidenceIntegrityResult } from "@/lib/services/pdtp/evidence-integrity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Recalcula el sha256 de cada archivo con checksum registrado: crece con el
// storage. Sin techo, un corte de plataforma no dejaría señal.
export const maxDuration = 300

const SAMPLE_SIZE = 20

function summarize(result: Partial<PdtpEvidenceIntegrityResult>) {
  return {
    ok: result.ok,
    references: result.references,
    checkedFiles: result.checkedFiles,
    missingCount: result.missingCount,
    checksumMismatchCount: result.checksumMismatchCount,
    withoutChecksum: result.withoutChecksum,
    missingSample: (result.missing ?? []).slice(0, SAMPLE_SIZE).map((item) => item.path),
    checksumMismatchSample: (result.checksumMismatches ?? []).slice(0, SAMPLE_SIZE).map((item) => item.path),
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error("[cron/pdtp-evidence-integrity] CRON_SECRET is not configured")
    return NextResponse.json({ ok: false, outcome: "failed", code: "PREVENTION_CRON_CONFIGURATION", error: "Cron secret not configured" }, { status: 500 })
  }
  if (!verifyCronSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "PREVENTION_CRON_UNAUTHORIZED", error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await withCronLock("pdtp-evidence-integrity", () => scanPdtpEvidenceIntegrity())
    if ("skipped" in result && result.skipped === true) {
      return NextResponse.json({ ok: true, outcome: "skipped", code: "PREVENTION_CRON_SKIPPED", reason: result.reason })
    }
    const integrity = summarize(result as Partial<PdtpEvidenceIntegrityResult>)
    return NextResponse.json({ ok: true, outcome: "success", code: "PREVENTION_CRON_SUCCESS", integrity })
  } catch (error) {
    logger.error("[cron/pdtp-evidence-integrity] failed", error)
    return NextResponse.json({ ok: false, outcome: "failed", code: "PREVENTION_CRON_FAILED", error: "Internal cron error" }, { status: 503 })
  }
}

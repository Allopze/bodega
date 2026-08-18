/**
 * GET /api/cron/pdtp-evidence-gc
 *
 * Endpoint protegido por CRON_SECRET para ejecutar el garbage collector
 * de archivos huérfanos en `storage/pdtp-evidence/`. Pensado para llamarse
 * semanalmente (lunes 3 AM) desde un cron externo.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://yourdomain/api/cron/pdtp-evidence-gc?olderThanMs=86400000
 *
 * Query params:
 *   - olderThanMs=N: umbral de antigüedad en ms (default 1h).
 *
 * Devuelve: `{ ok, scanned, deleted, kept, failed, deletedNames, dryRun }`.
 */
export const dynamic = "force-dynamic"
// Techo explícito: estos jobs recorren tablas que crecen y sin cota un
// corte por timeout de plataforma deja estado parcial sin señal accionable.
export const maxDuration = 300
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { cleanupPdtpEvidenceOrphans } from "@/lib/services/pdtp/evidence-gc"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get("authorization")

  if (!secret) {
    logger.error("[cron/pdtp-evidence-gc] CRON_SECRET is not configured")
    return NextResponse.json({ error: "Cron secret not configured" }, { status: 500 })
  }

  if (!verifyCronSecret(authHeader, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = req.nextUrl
  const dryRun = url.searchParams.get("dryRun") === "true"
  const olderThanMsParam = url.searchParams.get("olderThanMs")
  const olderThanMs = olderThanMsParam ? Number(olderThanMsParam) : undefined
  if (olderThanMs !== undefined && (!Number.isFinite(olderThanMs) || olderThanMs < 0)) {
    return NextResponse.json({ error: "olderThanMs inválido" }, { status: 400 })
  }

  try {
    const result = await withCronLock("pdtp-evidence-gc", () => cleanupPdtpEvidenceOrphans({ dryRun, olderThanMs }))
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    logger.error("[cron/pdtp-evidence-gc] Fatal error", err)
    const isProd = process.env.NODE_ENV === "production"
    return NextResponse.json(
      { error: isProd ? "Internal cron error" : (err instanceof Error ? err.message : "Unknown error") },
      { status: 500 },
    )
  }
}

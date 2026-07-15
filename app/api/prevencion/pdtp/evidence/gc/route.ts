/**
 * POST /api/prevencion/pdtp/evidence/gc
 *
 * Endpoint admin para limpiar archivos huérfanos en
 * `storage/pdtp-evidence/`. Acepta query params:
 *   - dryRun=true: solo reporta, no borra.
 *   - olderThanMs=N: umbral de antigüedad (default 1h).
 *
 * Protegido por sesión + permiso `prevention:pdtp:program:manage`. Pensado
 * para llamarse manualmente o desde un cron externo.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { cleanupPdtpEvidenceOrphans } from "@/lib/services/pdtp/evidence-gc"
import { logger } from "@/lib/logger"

export async function POST(request: NextRequest): Promise<Response> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:pdtp:program:manage")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const url = request.nextUrl
  const dryRun = url.searchParams.get("dryRun") === "true"
  const olderThanMsParam = url.searchParams.get("olderThanMs")
  const olderThanMs = olderThanMsParam ? Number(olderThanMsParam) : undefined
  if (olderThanMs !== undefined && (!Number.isFinite(olderThanMs) || olderThanMs < 0)) {
    return NextResponse.json({ error: "olderThanMs inválido" }, { status: 400 })
  }

  try {
    const result = await cleanupPdtpEvidenceOrphans({ dryRun, olderThanMs })
    return NextResponse.json({ ok: true, dryRun, ...result })
  } catch (err) {
    logger.error("[pdtp/evidence/gc]", err)
    return NextResponse.json({ error: "Error al limpiar evidencia" }, { status: 500 })
  }
}

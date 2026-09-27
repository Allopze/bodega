/**
 * POST /api/prevencion/pdtp/evidence/gc
 *
 * Endpoint admin para limpiar archivos huérfanos en
 * `storage/pdtp-evidence/`. Acepta query params:
 *   - dryRun=true: solo reporta, no borra.
 *   - olderThanMs=N: umbral de antigüedad (default y mínimo: 24 h).
 *
 * Responde conteos y una muestra de 20 nombres (revisión final 2026-09-27):
 * la lista completa podía tener miles de nombres; queda en la fila de
 * auditoría `storage_orphan_sweep`.
 *
 * W5-GC (T7a, D13): obedece la misma llave que el cron. Mientras
 * `PDTP_EVIDENCE_GC_DELETE` no valga `true`, corre en modo de prueba aunque no
 * se pida `dryRun`: antes este endpoint borraba por omisión y dejaba abierta
 * la puerta que el cron cerró. La fila de auditoría lleva a quien lo llamó.
 *
 * Protegido por sesión + permiso `prevention:pdtp:program:manage`.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { cleanupPdtpEvidenceOrphans } from "@/lib/services/pdtp/evidence-gc"
import { MIN_ORPHAN_AGE_LABEL, MIN_ORPHAN_AGE_MS, summarizeOrphanCleanup } from "@/lib/services/pdtp/evidence-gc-policy"
import { logger } from "@/lib/logger"

export async function POST(request: NextRequest): Promise<Response> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:pdtp:program:manage")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const url = request.nextUrl
  const dryRun = url.searchParams.get("dryRun") === "true" || process.env.PDTP_EVIDENCE_GC_DELETE !== "true"
  const olderThanMsParam = url.searchParams.get("olderThanMs")
  const olderThanMs = olderThanMsParam ? Number(olderThanMsParam) : undefined
  if (olderThanMs !== undefined && (!Number.isFinite(olderThanMs) || olderThanMs < MIN_ORPHAN_AGE_MS)) {
    return NextResponse.json({ error: `olderThanMs inválido: el mínimo es ${MIN_ORPHAN_AGE_MS} (${MIN_ORPHAN_AGE_LABEL}).` }, { status: 400 })
  }

  try {
    const result = await cleanupPdtpEvidenceOrphans({ dryRun, olderThanMs, actorUserId: session.user?.id ?? null })
    return NextResponse.json({ ok: true, dryRun, ...summarizeOrphanCleanup(result) })
  } catch (err) {
    logger.error("[pdtp/evidence/gc]", err)
    return NextResponse.json({ error: "Error al limpiar evidencia" }, { status: 500 })
  }
}

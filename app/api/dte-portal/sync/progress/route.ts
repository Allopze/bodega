import { NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { dteSyncRuns } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { readDteSyncProgress } from "@/lib/services/dte-portal/sync-progress"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/dte-portal/sync/progress — avance de la corrida DTE en curso.
 * Requiere permiso admin:dte_sync.
 *
 * Es un GET y no una server action a propósito: el botón manual mantiene su
 * acción en vuelo durante toda la corrida y el router encola las siguientes, así
 * que un sondeo por acción recién respondería cuando ya no hay nada que mostrar.
 */
export async function GET() {
  try {
    await requirePermission("admin:dte_sync")
  } catch {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const run = await db.query.dteSyncRuns.findFirst({
    where: eq(dteSyncRuns.status, "running"),
    orderBy: [desc(dteSyncRuns.startedAt)],
    columns: { id: true, periodo: true, startedAt: true },
  })
  if (!run) return NextResponse.json({ active: false })

  // El avance publicado sólo vale si es de ESTA corrida: el de un proceso que
  // murió a medio camino sobrevive hasta que el barrido de colgadas lo cierre.
  const progress = await readDteSyncProgress()
  const detail = progress?.runId === run.id ? progress : null

  return NextResponse.json({
    active: true,
    periodo: run.periodo,
    startedAt: run.startedAt,
    phase: detail?.phase ?? "portal",
    processed: detail?.processed ?? 0,
    total: detail?.total ?? 0,
  })
}

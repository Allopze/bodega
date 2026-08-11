import { NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/auth/can"
import { DtePortalClient } from "@/lib/services/dte-portal/client"
import { buildDtePortalClientConfig, isDteSyncEnabled } from "@/lib/services/dte-portal/config"
import { classifyDteFailure } from "@/lib/services/dte-portal/failure"
import { syncDteDocuments } from "@/lib/services/dte-portal/sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/dte-portal/sync
 *
 * Sincronización manual del libro de compras DTE.
 * Requiere permiso admin:dte_sync.
 *
 * Body (opcional):
 *   { periodo?: "YYYY-MM", force?: boolean }
 */
export async function POST(request: NextRequest) {
  let session
  try {
    session = await requirePermission("admin:dte_sync")
  } catch {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  let body: { periodo?: string; force?: boolean } = {}
  try {
    body = await request.json()
  } catch {
    // Body vacío está OK, usamos defaults
  }

  // Validar formato de período si se proporcionó
  if (body.periodo && !/^\d{4}-\d{2}$/.test(body.periodo)) {
    return NextResponse.json(
      { error: "Formato de período inválido. Use YYYY-MM." },
      { status: 400 },
    )
  }

  try {
    if (!(await isDteSyncEnabled())) {
      return NextResponse.json(
        { error: "La sincronización DTE no está habilitada. Configúrela en Administración › Sincronización DTE o con DTE_SYNC_ENABLED=true." },
        { status: 400 },
      )
    }

    const config = await buildDtePortalClientConfig()
    const client = new DtePortalClient(config)

    const result = await syncDteDocuments(client, {
      periodo: body.periodo,
      trigger: "manual",
      force: body.force,
      importerId: session.user.id,
    })

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      periodo: result.periodo,
      status: result.status,
      rowsSeen: result.rowsSeen,
      rowsInserted: result.rowsInserted,
      rowsUpdated: result.rowsUpdated,
      correlationId: result.correlationId,
      // Sync persists a redacted summary for the admin history. The API keeps
      // the wire contract even narrower: callers get a stable code only.
      code: result.error?.split(":", 1)[0] ?? null,
    })
  } catch (error) {
    const failure = classifyDteFailure(error)
    return NextResponse.json({ ok: false, code: failure.code, error: failure.summary }, { status: 500 })
  }
}

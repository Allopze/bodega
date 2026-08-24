import { NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/auth/can"
import { DtePortalClient } from "@/lib/services/dte-portal/client"
import { buildDtePortalClientConfig, isDteSyncEnabled } from "@/lib/services/dte-portal/config"
import { classifyDteFailure } from "@/lib/services/dte-portal/failure"
import { assertSyncablePeriodo, syncDteDocuments } from "@/lib/services/dte-portal/sync"
import { revalidatePath } from "next/cache"

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

  // Validar el período con el MISMO predicado del servicio. La regex local era
  // más débil (aceptaba "2026-13" y "2026-00") y esos casos terminaban en el
  // catch genérico: un 500 "DTE_UNEXPECTED" por un error de entrada del
  // llamante, sin decirle cuál.
  if (body.periodo) {
    try {
      assertSyncablePeriodo(body.periodo)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Formato de período inválido. Use YYYY-MM." },
        { status: 400 },
      )
    }
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
    if (result.status === "success" || result.status === "partial") revalidatePath("/compras")

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

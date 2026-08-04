import { NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/auth/can"
import { DtePortalClient } from "@/lib/services/dte-portal/client"
import { buildDtePortalClientConfig, isDteSyncEnabled } from "@/lib/services/dte-portal/config"
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

  if (!isDteSyncEnabled()) {
    return NextResponse.json(
      { error: "La sincronización DTE no está habilitada. Configure DTE_SYNC_ENABLED=true." },
      { status: 400 },
    )
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
    const config = buildDtePortalClientConfig()
    const client = new DtePortalClient(config)

    const result = await syncDteDocuments(client, {
      periodo: body.periodo,
      trigger: "manual",
      force: body.force,
      importerId: session.user.id,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de sincronización DTE"
    // No exponer detalles técnicos de credenciales
    const safeMessage = message.includes("clave") || message.includes("rut_usr")
      ? "Error de configuración del portal DTE"
      : message
    return NextResponse.json({ ok: false, error: safeMessage }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from "next/server"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { DtePortalClient } from "@/lib/services/dte-portal/client"
import { buildDtePortalClientConfig, isDteSyncEnabled } from "@/lib/services/dte-portal/config"
import { syncDteDocuments } from "@/lib/services/dte-portal/sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/cron/dte-portal-sync
 *
 * Sincronización automática del libro de compras DTE (mes actual).
 * Protegido por CRON_SECRET.
 * Patrón: fuel-copec-sync.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !verifyCronSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!isDteSyncEnabled()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "DTE sync not enabled" })
  }

  try {
    const config = buildDtePortalClientConfig()
    const client = new DtePortalClient(config)

    const result = await syncDteDocuments(client, { trigger: "cron" })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "DTE portal sync failed"
    // Sanitize credential leaks
    const safeMessage = message.includes("clave") || message.includes("rut_usr")
      ? "DTE portal configuration error"
      : message
    return NextResponse.json({ ok: false, error: safeMessage }, { status: 500 })
  }
}

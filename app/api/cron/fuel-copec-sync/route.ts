import { NextRequest, NextResponse } from "next/server"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { syncCopecReports } from "@/lib/combustibles/copec-sync"
import { isRouteOperational } from "@/lib/services/module-toggles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !verifyCronSecret(request.headers.get("authorization"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!await isRouteOperational("/combustibles/importar")) {
    return NextResponse.json({ error: "Importación de combustibles inactiva" }, { status: 503 })
  }
  try { return NextResponse.json({ ok: true, ...(await syncCopecReports()) }) }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Copec sync failed" }, { status: 500 }) }
}

import { type NextRequest, NextResponse } from "next/server"
import { captureOperationalMetricSnapshots } from "@/lib/services/operational-metric-snapshots"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Ejecutar diariamente con Authorization: Bearer $CRON_SECRET. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: "Cron secret not configured" }, { status: 500 })
  if (!verifyCronSecret(request.headers.get("authorization"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const result = await captureOperationalMetricSnapshots()
    logger.info("[cron/operational-metric-snapshots] completed", result)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    logger.error("[cron/operational-metric-snapshots] failed", error)
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal cron error" : (error instanceof Error ? error.message : "Unknown error") }, { status: 500 })
  }
}

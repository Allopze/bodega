import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { runTiAlerts } from "@/lib/services/ti/alerts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ outcome: "failed", code: "TI_CRON_CONFIGURATION" }, { status: 500 })
  if (!verifyCronSecret(request.headers.get("authorization"), secret)) return NextResponse.json({ outcome: "unauthorized", code: "TI_CRON_UNAUTHORIZED" }, { status: 401 })
  try {
    const result = await withCronLock("ti-alerts", () => runTiAlerts())
    logger.info("[cron/ti-alerts] completed", result)
    return NextResponse.json({ outcome: "success", code: "TI_CRON_SUCCESS", ...result })
  } catch (error) {
    logger.error("[cron/ti-alerts] failed", error)
    return NextResponse.json({ outcome: "failed", code: "TI_CRON_FAILED" }, { status: 503 })
  }
}

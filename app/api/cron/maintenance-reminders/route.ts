import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { runMaintenanceReminders } from "@/lib/services/maintenance-reminders"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ outcome: "failed", code: "MAINTENANCE_CRON_CONFIGURATION" }, { status: 500 })
  if (!verifyCronSecret(request.headers.get("authorization"), secret)) return NextResponse.json({ outcome: "unauthorized", code: "MAINTENANCE_CRON_UNAUTHORIZED" }, { status: 401 })
  try {
    const result = await withCronLock("maintenance-reminders", () => runMaintenanceReminders())
    logger.info("[cron/maintenance-reminders] completed", result)
    return NextResponse.json({ outcome: "success", code: "MAINTENANCE_CRON_SUCCESS", ...result })
  } catch (error) {
    logger.error("[cron/maintenance-reminders] failed", error)
    return NextResponse.json({ outcome: "failed", code: "MAINTENANCE_CRON_FAILED" }, { status: 503 })
  }
}

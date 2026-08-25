import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { runFeedbackSlaReminders } from "@/lib/services/feedback-sla-reminders"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ ok: false, outcome: "failed", code: "FEEDBACK_CRON_CONFIGURATION" }, { status: 500 })
  if (!verifyCronSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "FEEDBACK_CRON_UNAUTHORIZED" }, { status: 401 })
  }

  try {
    const result = await withCronLock("feedback-sla-reminders", () => runFeedbackSlaReminders())
    logger.info("[cron/feedback-sla-reminders] completed", result)
    return NextResponse.json({ ok: true, outcome: "success", code: "FEEDBACK_CRON_SUCCESS", ...result })
  } catch (error) {
    logger.error("[cron/feedback-sla-reminders] failed", error)
    return NextResponse.json({ ok: false, outcome: "failed", code: "FEEDBACK_CRON_FAILED" }, { status: 503 })
  }
}

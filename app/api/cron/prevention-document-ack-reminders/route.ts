import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { runPreventionDocumentAckReminders } from "@/lib/services/prevention-document-ack-reminders"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error("[cron/prevention-document-ack-reminders] CRON_SECRET is not configured")
    return NextResponse.json({ error: "Cron secret not configured" }, { status: 500 })
  }
  if (!verifyCronSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await runPreventionDocumentAckReminders()
    logger.info("[cron/prevention-document-ack-reminders] completed", result)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    logger.error("[cron/prevention-document-ack-reminders] failed", error)
    return NextResponse.json({ error: "Internal cron error" }, { status: 500 })
  }
}

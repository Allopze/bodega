/**
 * GET /api/cron/backup-health
 *
 * Verifica diariamente la edad del último backup exitoso y reporta
 * si está vencido (>36h) o falló. Protegido por CRON_SECRET.
 *
 * Llamar diariamente via cron externo:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain/api/cron/backup-health
 */
import { type NextRequest, NextResponse } from "next/server"
import { getBackupStats, getBackupConfig } from "@/lib/services/backups"
import { logger } from "@/lib/logger"
import { safeActionMessage } from "@/lib/action-error"
import { verifyCronSecret } from "@/lib/security/cron-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get("authorization")

  if (!secret) {
    logger.error("[cron/backup-health] CRON_SECRET not configured")
    return NextResponse.json({ error: "Cron secret not configured" }, { status: 500 })
  }

  if (!verifyCronSecret(authHeader, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const [stats, config] = await Promise.all([
      getBackupStats(),
      getBackupConfig(),
    ])

    const maxAgeHours = config.maxAgeHours

    let status = "healthy"
    const alerts: string[] = []

    if (stats.lastBackup) {
      const ageMs = Date.now() - new Date(stats.lastBackup.startedAt).getTime()
      const ageHours = Math.round(ageMs / 3600000)

      if (stats.lastBackup.status === "failed") {
        status = "critical"
        alerts.push(`Last backup FAILED (${ageHours}h ago)`)
      } else if (ageHours > maxAgeHours) {
        status = "critical"
        alerts.push(`Last backup is ${ageHours}h old (max: ${maxAgeHours}h)`)
      } else {
        alerts.push(`Last backup OK (${ageHours}h ago, status: ${stats.lastBackup.status})`)
      }
    } else {
      status = "critical"
      alerts.push("No backup records found in backup_log table")
    }

    if (stats.failedCount > 0) {
      alerts.push(`${stats.failedCount} failed backup(s) on record`)
    }

    if (stats.runningCount > 2) {
      status = status === "healthy" ? "degraded" : status
      alerts.push(`${stats.runningCount} backups currently running (possible stuck job)`)
    }

    if (status === "critical") {
      logger.warn("[cron/backup-health] Critical alerts", { alerts, stats: { last: stats.lastBackup?.status, age: stats.lastBackup ? `${Math.round((Date.now() - new Date(stats.lastBackup.startedAt).getTime()) / 3600000)}h` : "none" } })
    }

    return NextResponse.json({
      ok: true,
      status,
      alerts,
      lastBackupDate: stats.lastBackup?.startedAt ?? null,
      totalBackups: stats.totalBackups,
      successCount: stats.successCount,
      failedCount: stats.failedCount,
    })
  } catch (err) {
    logger.error("[cron/backup-health] Fatal error", err)
    return NextResponse.json(
      { error: safeActionMessage(err, "Unknown error") },
      { status: 500 },
    )
  }
}

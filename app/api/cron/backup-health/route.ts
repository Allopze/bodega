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
import { todayInChile } from "@/lib/utils"
import { safeActionMessage } from "@/lib/action-error"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { backupCronContractFor, type BackupCronHealth } from "@/lib/services/backup-cron-contract"
import { createNotifications } from "@/lib/services/notification-create"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * BCK-002 (auditoría 2026-09-14): el diagnóstico vivía en la pantalla de
 * administración de respaldos y en el log del servidor. No había notificación
 * ni correo, de modo que —sumado a `BCK-001`, que devolvía 200 con el último
 * respaldo fallido— la ausencia de respaldos era invisible salvo que alguien
 * entrara a mirar. El resto de la plataforma sí notifica: mantenciones por SLA,
 * CAPA por vencimiento, capacitación por competencias que caducan.
 *
 * La llave de deduplicación lleva el día: se avisa una vez al día mientras el
 * problema dure, no en cada corrida. Un fallo al notificar no cambia el
 * contrato de la ruta —el estado crítico ya viaja en el 503 y en el código de
 * salida del runner—, así que se registra y se sigue.
 */
async function notifyBackupCritical(alerts: string[], lastBackupAt: string | null): Promise<void> {
  try {
    const recipients = await getUserIdsWithPermission("admin:backups")
    if (recipients.length === 0) {
      logger.error("[cron/backup-health] estado crítico sin nadie a quien avisar: ningún usuario tiene admin:backups")
      return
    }
    await createNotifications(recipients, {
      type: "system_alert",
      title: "Respaldos en estado crítico",
      body: alerts.join(" · "),
      entityType: "backup_health",
      entityId: "backup-health",
      entityHref: "/admin/backups",
      dedupeKey: `backup-health:critical:${todayInChile()}:${lastBackupAt ?? "sin-respaldo"}`,
    })
  } catch (err) {
    logger.error("[cron/backup-health] no se pudo notificar el estado crítico", err)
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get("authorization")

  if (!secret) {
    logger.error("[cron/backup-health] CRON_SECRET not configured")
    const contract = backupCronContractFor({ misconfigured: true })
    return NextResponse.json({ ...contract, error: "Cron secret not configured" }, { status: contract.httpStatus })
  }

  if (!verifyCronSecret(authHeader, secret)) {
    const contract = backupCronContractFor({ unauthorized: true })
    return NextResponse.json({ ...contract, error: "Unauthorized" }, { status: contract.httpStatus })
  }

  try {
    const [stats, config] = await Promise.all([
      getBackupStats(),
      getBackupConfig(),
    ])

    const maxAgeHours = config.maxAgeHours

    let status: BackupCronHealth = "healthy"
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
      await notifyBackupCritical(alerts, stats.lastBackup?.startedAt ?? null)
    }

    // BCK-001: el desenlace decide el estado HTTP y el código de salida del
    // runner. Antes esto respondía 200/`ok: true` incluso con el último respaldo
    // fallido o inexistente, así que el planificador externo daba por buena una
    // corrida que estaba avisando lo contrario.
    const contract = backupCronContractFor({ health: status })
    return NextResponse.json({
      ...contract,
      status,
      alerts,
      lastBackupDate: stats.lastBackup?.startedAt ?? null,
      totalBackups: stats.totalBackups,
      successCount: stats.successCount,
      failedCount: stats.failedCount,
    }, { status: contract.httpStatus })
  } catch (err) {
    logger.error("[cron/backup-health] Fatal error", err)
    const contract = backupCronContractFor({ misconfigured: true })
    return NextResponse.json(
      { ...contract, error: safeActionMessage(err, "Unknown error") },
      { status: contract.httpStatus },
    )
  }
}

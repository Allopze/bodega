import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { getBackupStats, getRecentBackups, getDriveHealth, getSaStatusSummary } from "@/lib/services/backups"
import SaHealthSection from "./sa-health-section"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { BackupsStatusCards } from "./backup-status-cards"
import { BackupsList } from "./backup-list"
import { BackupsActions } from "./backup-actions"
import { BackupSettingsForm } from "./backup-settings-form"
import { formatBytes } from "@/lib/format-bytes"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Respaldos del sistema" }

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—"
  const ms = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(ms / 3600000)
  if (hours < 1) return "Hace menos de 1 hora"
  if (hours < 24) return `Hace ${hours}h`
  const days = Math.floor(hours / 24)
  return `Hace ${days}d`
}

export default async function BackupsPage() {
  try { await requirePermission("admin:backups") }
  catch { redirect("/forbidden") }

  const [stats, recent, driveHealth] = await Promise.all([
    getBackupStats(),
    getRecentBackups(30),
    getDriveHealth().catch(() => null),
  ])

  const lastBackup = stats.lastBackup
  const lastSuccess = stats.lastSuccess
  const lastFailed = stats.lastFailed

  // Determinar estado de Drive
  let driveStatus: "success" | "failed" | "running" | "none" = "none"
  let driveLabel: string
  if (driveHealth?.reachable) {
    driveStatus = "success"
    driveLabel = "Conectado y accesible"
  } else if (driveHealth?.remoteConfigured && !driveHealth?.reachable) {
    driveStatus = "failed"
    driveLabel = "Configurado pero no accesible"
  } else if (driveHealth?.rcloneInstalled && !driveHealth?.remoteConfigured) {
    driveStatus = "none"
    driveLabel = "rclone instalado, remote no configurado"
  } else if (!driveHealth?.rcloneInstalled) {
    driveStatus = "none"
    driveLabel = "rclone no instalado"
  } else {
    driveLabel = stats.driveUploaded ? "Último backup subido" : "Pendiente"
  }
  // Agregar detalle del SA JSON si aplica
  if (driveHealth && driveStatus === "success") {
    const saStatus = driveHealth.saJsonPresent ? "✓ SA" : "✗ SA"
    driveLabel += ` (${saStatus})`
  }

  const statusCards = [
    {
      label: "Último respaldo",
      value: lastBackup ? `${lastBackup.backupDate} (${timeAgo(lastBackup.startedAt)})` : "Sin respaldos",
      status: (lastBackup?.status ?? "none") as "success" | "failed" | "running" | "none",
    },
    {
      label: "Último exitoso",
      value: lastSuccess ? `${lastSuccess.backupDate} (${timeAgo(lastSuccess.startedAt)})` : "—",
      status: lastSuccess ? "success" : "none" as "success" | "failed" | "running" | "none",
    },
    {
      label: "Último fallido",
      value: lastFailed ? `${lastFailed.backupDate} — ${lastFailed.errorMessage ?? "Error desconocido"}` : "Sin fallos",
      status: lastFailed ? "failed" : "success" as "success" | "failed" | "running" | "none",
    },
    {
      label: "Respaldos (7 días)",
      value: `${stats.backupsLast7Days} ejecutados`,
      status: stats.backupsLast7Days > 0 ? "success" : "failed" as "success" | "failed" | "running" | "none",
    },
    {
      label: "Tamaño total",
      value: formatBytes(stats.totalSizeBytes ?? lastBackup?.totalSizeBytes ?? null),
      status: "none" as "success" | "failed" | "running" | "none",
    },
    {
      label: "Google Drive",
      value: driveLabel,
      status: driveStatus,
    },
  ]

  const saSummary = driveHealth ? getSaStatusSummary(driveHealth) : null

  return (
    <PageContainer>
      <PageHeader
        title="Respaldos del sistema"
        description="Monitorea, ejecuta y verifica los respaldos automáticos de la plataforma."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Respaldos" },
          ]} />
        }
        actions={<BackupsActions />}
      />
      <BackupsStatusCards cards={statusCards} />

      {/* ── Backup Settings ──────────────────────────────────────────── */}
      <BackupSettingsForm />

      {/* ── Service Account Health ───────────────────────────────────── */}
      {driveHealth && saSummary && (
        <SaHealthSection initialHealth={driveHealth} initialSummary={saSummary} />
      )}

      <BackupsList backups={recent.map((b) => ({
        id: b.id,
        date: b.backupDate,
        startedAt: b.startedAt,
        completedAt: b.completedAt,
        status: b.status,
        trigger: b.trigger,
        pgSizeBytes: b.pgSizeBytes,
        storageSizeBytes: b.storageSizeBytes,
        configSizeBytes: b.configSizeBytes,
        totalSizeBytes: b.totalSizeBytes,
        driveUploaded: b.driveUploaded,
        manifestSha256: b.manifestSha256?.slice(0, 16) ?? null,
        errorMessage: b.errorMessage,
        appVersion: b.appVersion,
      }))} />
    </PageContainer>
  )
}



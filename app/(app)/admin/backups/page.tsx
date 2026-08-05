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
import { buildBackupStatusCards } from "./backup-health"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Respaldos del sistema" }

const BACKUPS_BREADCRUMBS = (
  <Breadcrumbs items={[
    { label: "Inicio", href: "/dashboard" },
    { label: "Administración", href: "/admin" },
    { label: "Respaldos" },
  ]} />
)

const BACKUPS_ACTIONS = <BackupsActions />

export default async function BackupsPage() {
  try { await requirePermission("admin:backups") }
  catch { redirect("/forbidden") }

  const [stats, recent, driveHealth] = await Promise.all([
    getBackupStats(),
    getRecentBackups(30),
    getDriveHealth().catch(() => null),
  ])

  const statusCards = buildBackupStatusCards(stats, driveHealth)

  const saSummary = driveHealth ? getSaStatusSummary(driveHealth) : null

  return (
    <PageContainer>
      <PageHeader
        title="Respaldos del sistema"
        description="Monitorea, ejecuta y verifica los respaldos automáticos de la plataforma."
        breadcrumb={BACKUPS_BREADCRUMBS}
        actions={BACKUPS_ACTIONS}
      />
      {stats.totalBackups === 0 && (
        <section role="alert" className="mb-5 rounded-[var(--radius-xl)] border border-[var(--color-danger)] bg-[var(--color-danger-tint)] p-4 text-[var(--color-danger-ink)]">
          <h2 className="font-semibold">Aún no existe un respaldo verificable</h2>
          <p className="mt-1 text-sm">Configura la política, confirma el destino remoto y ejecuta el primer respaldo antes de depender de esta recuperación.</p>
          <a href="#backup-settings" className="mt-3 inline-flex min-h-11 items-center rounded-[var(--radius)] bg-[var(--color-danger)] px-3 text-sm font-semibold text-white hover:opacity-90">Revisar configuración</a>
        </section>
      )}
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


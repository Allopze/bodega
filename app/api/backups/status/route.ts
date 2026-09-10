/**
 * GET /api/backups/status
 *
 * Devuelve el estado actual del sistema de backups:
 * - Último backup (fecha, estado, tamaño, checksum)
 * - Estadísticas (totales, éxito/fallo últimos 7 días)
 * - Verificación de script de backup (¿existe?)
 * - Estado de Google Drive (última subida)
 *
 * Usado por el panel admin /admin/backups. Exige `admin:backups`: no es un
 * endpoint de monitoreo externo. Para eso, exponer uno nuevo por CRON_SECRET
 * como hace /api/backups/config.
 */
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { getBackupStats, getLatestBackup, getDriveHealth, getBackupConfig } from "@/lib/services/backups"
import { probeCloudreveBackupPath } from "@/lib/services/cloudreve/client"
import { normalizeBackupCloudrevePath } from "@/lib/services/cloudreve/backup"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const BACKUP_SCRIPT_NAMES = [
  "backup-orchestrator.sh",
  "backup-pg.sh",
  "backup-storage.sh",
  "restore-all.sh",
  "backup-verify.sh",
]

// Keep the runtime path explicit so Next's standalone tracer does not follow
// the whole filesystem through process.cwd()/path.resolve. Deploy images copy
// backup scripts to /app/scripts; local runs keep the repository-relative path.
const SCRIPTS_DIR = process.env.BACKUP_SCRIPTS_PATH
  ?? (process.env.NODE_ENV === "production" ? "/app/scripts" : "scripts")

interface BackupApiStatus {
  status: "ok" | "degraded" | "error"
  lastBackup: {
    date: string | null
    status: string | null
    age_hours: number | null
    total_size_bytes: number | null
    drive_uploaded: boolean | null
    cloudreve_uploaded: boolean | null
  }
  stats: {
    total: number
    success: number
    failed: number
    running: number
    last_7_days: number
  }
  scripts: Record<string, boolean>
  drive: {
    rclone_installed: boolean
    remote_configured: boolean
    sa_json_present: boolean
    reachable: boolean
    last_checked: string | null
  }
  cloudreve: {
    enabled: boolean
    path: string
    reachable: boolean | null
    message: string
  }
  timestamp: string
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "admin:backups")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })

  const result: BackupApiStatus = {
    status: "ok",
    lastBackup: {
      date: null,
      status: null,
      age_hours: null,
      total_size_bytes: null,
      drive_uploaded: null,
      cloudreve_uploaded: null,
    },
    stats: {
      total: 0,
      success: 0,
      failed: 0,
      running: 0,
      last_7_days: 0,
    },
    scripts: {},
    drive: {
      rclone_installed:  false,
      remote_configured: false,
      sa_json_present:   false,
      reachable:         false,
      last_checked:      null,
    },
    cloudreve: {
      enabled:   false,
      path:      "",
      reachable: null,
      message:   "",
    },
    timestamp: new Date().toISOString(),
  }

  // 1. Check script existence at runtime. Passing the path as an argv value
  // keeps Next's build tracer from treating the configurable directory as a
  // source glob and bundling the whole repository.
  const scriptChecks = await Promise.all(BACKUP_SCRIPT_NAMES.map(async (name) => {
    try {
      await execFileAsync("test", ["-f", `${SCRIPTS_DIR}/${name}`], { timeout: 1000 })
      return [name, true] as const
    } catch {
      return [name, false] as const
    }
  }))
  for (const [name, exists] of scriptChecks) {
    result.scripts[name] = exists
    if (!result.scripts[name]) {
      result.status = "degraded"
    }
  }

  // 2. Query backup stats from DB
  try {
    const [stats, latest, config] = await Promise.all([
      getBackupStats(),
      getLatestBackup(),
      getBackupConfig(),
    ])

    result.stats = {
      total: stats.totalBackups,
      success: stats.successCount,
      failed: stats.failedCount,
      running: stats.runningCount,
      last_7_days: stats.backupsLast7Days,
    }

    if (latest) {
      const ageMs = Date.now() - new Date(latest.startedAt).getTime()
      const ageHours = Math.round(ageMs / 3600000)

      result.lastBackup = {
        date: latest.backupDate,
        status: latest.status,
        age_hours: ageHours,
        total_size_bytes: latest.totalSizeBytes,
        drive_uploaded: latest.driveUploaded,
        cloudreve_uploaded: latest.cloudreveUploaded,
      }

      // Warning if last backup is old (uses persisted maxAgeHours)
      if (ageHours > config.maxAgeHours && result.status === "ok") {
        result.status = "degraded"
      }

      // Critical if last backup failed
      if (latest.status === "failed") {
        result.status = "degraded"
      }
    }
  } catch (_err) {
    // DB table may not exist yet (migration not applied)
    result.status = "degraded"
  }

  // 3. Drive healthcheck
  try {
    const drive = await getDriveHealth()
    result.drive = {
      rclone_installed:  drive.rcloneInstalled,
      remote_configured: drive.remoteConfigured,
      sa_json_present:   drive.saJsonPresent,
      reachable:         drive.reachable,
      last_checked:      drive.lastChecked,
    }
    if (!drive.reachable && drive.remoteConfigured && result.status === "ok") {
      result.status = "degraded"
    }
    if (!drive.remoteConfigured && drive.rcloneInstalled && result.status === "ok") {
      result.status = "degraded"
    }
  } catch {
    result.drive = {
      rclone_installed:  false,
      remote_configured: false,
      sa_json_present:   false,
      reachable:         false,
      last_checked:      null,
    }
  }

  // 3b. Cloudreve healthcheck (solo si el destino está activo)
  try {
    const config = await getBackupConfig()
    result.cloudreve = {
      enabled: config.cloudreveBackupsEnabled,
      path:    config.cloudreveBackupsPath,
      reachable: null,
      message: "",
    }
    if (config.cloudreveBackupsEnabled) {
      const probe = await probeCloudreveBackupPath(normalizeBackupCloudrevePath(config.cloudreveBackupsPath))
      result.cloudreve.reachable = probe.ok
      result.cloudreve.message = probe.message
      if (!probe.ok && result.status === "ok") {
        result.status = "degraded"
      }
    }
  } catch {
    result.cloudreve = { enabled: false, path: "", reachable: null, message: "" }
  }

  // 4. Quick check: try running backup-verify with --json (non-blocking, best-effort)
  //
  // backup-verify.sh sale con 1 (WARNING) o 2 (CRITICAL) justo cuando hay algo
  // que reportar, y execFile rechaza con cualquier código != 0. El JSON viene
  // igual en err.stdout: si se descarta el error sin mirarlo, la pantalla de
  // respaldos nunca muestra un problema — el único caso que importa.
  let verifyStdout = ""
  try {
    verifyStdout = (await execFileAsync(
      `${SCRIPTS_DIR}/backup-verify.sh`,
      ["--json"],
      { timeout: 15000 },
    )).stdout
  } catch (err) {
    verifyStdout = (err as { stdout?: string }).stdout ?? ""
  }

  try {
    const parsed = JSON.parse(verifyStdout)
    if (parsed && typeof parsed === "object" && typeof parsed.exit_code === "number") {
      if (parsed.exit_code === 2) {
        result.status = "error"
      } else if (parsed.exit_code === 1 && result.status === "ok") {
        result.status = "degraded"
      }
    }
  } catch {
    // Script verification is best-effort; don't fail the endpoint
  }

  const httpStatus = result.status === "error" ? 503 : 200
  return NextResponse.json(result, { status: httpStatus })
}

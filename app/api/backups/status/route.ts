/**
 * GET /api/backups/status
 *
 * Devuelve el estado actual del sistema de backups:
 * - Último backup (fecha, estado, tamaño, checksum)
 * - Estadísticas (totales, éxito/fallo últimos 7 días)
 * - Verificación de script de backup (¿existe?)
 * - Estado de Google Drive (última subida)
 *
 * Usado por:
 * - Panel admin /admin/backups
 * - Monitoreo externo (healthchecks.io, etc.)
 */
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getBackupStats, getLatestBackup, getDriveHealth, getBackupConfig } from "@/lib/services/backups"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { existsSync } from "node:fs"
import path from "node:path"

const execFileAsync = promisify(execFile)

// En Docker standalone (output: "standalone"), process.cwd() es .next/standalone/.
// Los scripts no están ahí, así que intentamos varias rutas.
function findScriptsDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "scripts"),
    path.resolve(process.cwd(), "..", "scripts"),          // standalone -> raíz
    path.resolve(process.cwd(), "..", "..", "scripts"),   // un paso más arriba
    process.env.BACKUP_SCRIPTS_PATH ?? "",
  ]
  for (const dir of candidates) {
    if (dir && existsSync(dir)) return dir
  }
  return null
}

const SCRIPTS_DIR = findScriptsDir()

interface BackupApiStatus {
  status: "ok" | "degraded" | "error"
  lastBackup: {
    date: string | null
    status: string | null
    age_hours: number | null
    total_size_bytes: number | null
    drive_uploaded: boolean | null
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
  timestamp: string
}

export async function GET() {
  const result: BackupApiStatus = {
    status: "ok",
    lastBackup: {
      date: null,
      status: null,
      age_hours: null,
      total_size_bytes: null,
      drive_uploaded: null,
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
    timestamp: new Date().toISOString(),
  }

  // 1. Check script existence
  const scriptNames = [
    "backup-orchestrator.sh",
    "backup-pg.sh",
    "backup-storage.sh",
    "restore-all.sh",
    "backup-verify.sh",
  ]

  for (const name of scriptNames) {
    if (SCRIPTS_DIR) {
      try {
        result.scripts[name] = existsSync(path.join(SCRIPTS_DIR, name))
      } catch {
        result.scripts[name] = false
      }
    } else {
      result.scripts[name] = false
    }
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

  // 4. Quick check: try running backup-verify with --json (non-blocking, best-effort)
  if (SCRIPTS_DIR) {
    try {
      const { stdout } = await execFileAsync(
        path.join(SCRIPTS_DIR, "backup-verify.sh"),
        ["--json"],
        { timeout: 15000 },
      )
      const parsed = JSON.parse(stdout)
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
  }

  const httpStatus = result.status === "error" ? 503 : 200
  return NextResponse.json(result, { status: httpStatus })
}

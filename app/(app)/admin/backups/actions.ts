"use server"

import { safeActionMessage } from "@/lib/action-error"

import { requirePermission } from "@/lib/auth/can"
import { createBackupLog, completeBackupLog, getBackupConfig, updateBackupConfig } from "@/lib/services/backups"
import type { BackupConfig } from "@/lib/services/backups"
import { probeCloudreveBackupPath } from "@/lib/services/cloudreve/client"
import { normalizeBackupCloudrevePath } from "@/lib/services/cloudreve/backup"
import { formatBytes } from "@/lib/format-bytes"
import { revalidatePath } from "next/cache"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import fs from "node:fs/promises"
import { todayInChile } from "@/lib/utils"

const execFileAsync = promisify(execFile)

export interface BackupActionResult {
  ok: boolean
  message: string
}

export async function triggerManualBackupAction(): Promise<BackupActionResult> {
  let logId: string | null = null

  try {
    const session = await requirePermission("admin:backups")
    const today = todayInChile()

    // ── 1. Registrar inicio en la BD ──────────────────────────────────────
    const log = await createBackupLog({
      backupDate: today,
      trigger: "manual",
      triggeredByUserId: session.user.id,
    })
    logId = log.id

    // ── 2. Localizar el script orquestador ────────────────────────────────
    const scriptsPath = process.env.BACKUP_SCRIPTS_PATH || ""
    const cwd = process.cwd()

    const candidatePaths = [
      ...(scriptsPath ? [path.join(scriptsPath, "backup-orchestrator.sh")] : []),
      path.resolve(cwd, "scripts", "backup-orchestrator.sh"),
      "/srv/bodega/scripts/backup-orchestrator.sh",
    ]

    let orchestratorPath = ""
    for (const p of candidatePaths) {
      try {
        await fs.access(p, fs.constants.X_OK)
        orchestratorPath = p
        break
      } catch { /* not found at this path */ }
    }

    if (!orchestratorPath) {
      // Fallback: maybe the script exists but isn't executable
      for (const p of candidatePaths) {
        try {
          await fs.access(p, fs.constants.F_OK)
          // Make it executable
          await fs.chmod(p, 0o755)
          orchestratorPath = p
          break
        } catch { /* not found */ }
      }
    }

    if (!orchestratorPath) {
      await completeBackupLog(logId, {
        status: "failed",
        errorMessage: "Script backup-orchestrator.sh no encontrado en el servidor",
        errorCode: "SCRIPT_NOT_FOUND",
        appVersion: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "unknown",
        hostname: "manual-trigger",
      })
      revalidatePath("/admin/backups")
      return {
        ok: false,
        message:
          "Script de backup no encontrado. Verifica que los scripts estén desplegados " +
          "o configura BACKUP_SCRIPTS_PATH en el entorno.",
      }
    }

    // ── 3. Asegurar directorios ───────────────────────────────────────────
    const backupDir = process.env.BACKUP_DIR || "/srv/bodega/backups"
    await fs.mkdir(path.join(backupDir, "snapshots"), { recursive: true })
    await fs.mkdir(path.join(backupDir, "pg"), { recursive: true })

    // ── 4. Ejecutar el orquestador ────────────────────────────────────────
    // Leer configuración persistida para timeout y retención
    let backupCfg: BackupConfig = {
      backupHour: 3,
      retentionDays: 30,
      maxAgeHours: 36,
      manualTimeoutMinutes: 30,
      driveBackupsEnabled: false,
      cloudreveBackupsEnabled: false,
      cloudreveBackupsPath: "backups/plataforma",
    }
    try {
      backupCfg = await getBackupConfig()
    } catch { /* usar defaults */ }

    // Pasar solo las variables que el orquestador necesita, no todo process.env.
    const env = {
      BACKUP_DIR: backupDir,
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      APP_VERSION:
        process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
        process.env.APP_VERSION ||
        "manual",
      GDRIVE_BACKUPS_DEST: process.env.GDRIVE_BACKUPS_DEST ?? "",
      STORAGE_PATH: process.env.STORAGE_PATH ?? "",
      RETENTION_DAYS: String(backupCfg.retentionDays),
      DRIVE_BACKUP_ENABLED: String(backupCfg.driveBackupsEnabled),
      CLOUDREVE_BACKUP_ENABLED: String(backupCfg.cloudreveBackupsEnabled),
      CLOUDREVE_BACKUP_PATH: backupCfg.cloudreveBackupsPath,
      // Sin esto el respaldo manual sube en claro mientras el programado va
      // cifrado: la peor variante, porque la configuración dice «cifrado» y
      // media de las copias no lo está.
      BACKUP_ENCRYPTION_PASSPHRASE: process.env.BACKUP_ENCRYPTION_PASSPHRASE ?? "",
      HOME: process.env.HOME ?? "/root",
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    } as Record<string, string>

    const { stdout } = await execFileAsync(orchestratorPath, [], {
      env: env as NodeJS.ProcessEnv,
      timeout: backupCfg.manualTimeoutMinutes * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    })

    // ── 5. Leer manifest.json con las métricas reales ─────────────────────
    const snapshotDir = path.join(backupDir, "snapshots", today)
    const manifestPath = path.join(snapshotDir, "manifest.json")

    let manifest: Record<string, unknown> | null = null
    try {
      const raw = await fs.readFile(manifestPath, "utf-8")
      manifest = JSON.parse(raw)
    } catch {
      // El snapshots puede crearse con la fecha-hora (YYYY-MM-DD-HHMMSS),
      // no solo con la fecha. Buscar el más reciente.
      try {
        const entries = await fs.readdir(path.join(backupDir, "snapshots"))
        const latest = entries.filter((e) => e.startsWith(today)).sort().reverse()[0]
        if (latest) {
          const altManifest = path.join(backupDir, "snapshots", latest, "manifest.json")
          const raw = await fs.readFile(altManifest, "utf-8")
          manifest = JSON.parse(raw)
        }
      } catch { /* no se pudo leer */ }
    }

    const c = manifest?.components as Record<string, Record<string, unknown>> | undefined
    const pg = c?.postgres
    const storage = c?.storage
    const config = c?.config

    const driveUploaded = !!(
      backupCfg.driveBackupsEnabled
      && process.env.GDRIVE_BACKUPS_DEST
      && stdout.includes("Upload completado")
    )

    const cloudreveUploaded = !!(
      backupCfg.cloudreveBackupsEnabled && stdout.includes("Cloudreve upload completado")
    )

    const result: Parameters<typeof completeBackupLog>[1] = {
      status: "success",
      pgSizeBytes: (pg?.size_bytes as number) ?? null,
      pgSha256: (pg?.sha256 as string) ?? null,
      storageSizeBytes: (storage?.size_bytes as number) ?? null,
      storageSha256: (storage?.sha256 as string) ?? null,
      configSizeBytes: (config?.size_bytes as number) ?? null,
      configSha256: (config?.sha256 as string) ?? null,
      manifestSha256: ((manifest?.integrity as Record<string, unknown>)?.manifest_sha256 as string) ?? null,
      totalSizeBytes: (manifest?.total_size_bytes as number) ?? null,
      driveUploaded,
      drivePath: backupCfg.driveBackupsEnabled && process.env.GDRIVE_BACKUPS_DEST
        ? `${process.env.GDRIVE_BACKUPS_DEST}/${today}`
        : undefined,
      cloudreveUploaded,
      cloudrevePath: cloudreveUploaded
        ? `${backupCfg.cloudreveBackupsPath}/${today}`
        : undefined,
      appVersion: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "unknown",
      hostname: ((manifest?.backup as Record<string, unknown>)?.hostname as string) ?? "",
    }

    await completeBackupLog(logId, result)

    const totalHuman = result.totalSizeBytes
      ? formatBytes(result.totalSizeBytes)
      : "desconocido"

    revalidatePath("/admin/backups")
    return { ok: true, message: `Backup completado (${totalHuman}).` }
  } catch (err) {
    // Si alcanzamos a crear el registro en BD, marcarlo como fallido
    if (logId) {
      try {
        await completeBackupLog(logId, {
          status: "failed",
          errorMessage:
            safeActionMessage(err, "Error desconocido"),
          errorCode: "BACKUP_FAILED",
          appVersion: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "unknown",
          hostname: "manual-trigger",
        })
      } catch { /* ignora error secundario */ }
    }

    revalidatePath("/admin/backups")
    return {
      ok: false,
      message: safeActionMessage(err, "Error al ejecutar backup"),
    }
  }
}

export async function verifyBackupsAction(): Promise<BackupActionResult> {
  try {
    await requirePermission("admin:backups")
    revalidatePath("/admin/backups")
    return { ok: true, message: "Estado actualizado." }
  } catch (err) {
    return {
      ok: false,
      message: safeActionMessage(err, "Error al verificar"),
    }
  }
}

export async function getBackupConfigAction(): Promise<BackupConfig> {
  await requirePermission("admin:backups")
  return getBackupConfig()
}

export async function updateBackupConfigAction(
  input: Partial<BackupConfig>,
): Promise<BackupConfig> {
  await requirePermission("admin:backups")
  const result = await updateBackupConfig(input)
  revalidatePath("/admin/backups")
  return result
}

/** Prueba la conexión a la carpeta de respaldos de Cloudreve con la config vigente. */
export async function probeCloudreveBackupAction(): Promise<{ ok: boolean; message: string }> {
  try {
    await requirePermission("admin:backups")
  } catch {
    return { ok: false, message: "No tiene permisos para probar la conexión." }
  }

  try {
    const config = await getBackupConfig()
    return await probeCloudreveBackupPath(normalizeBackupCloudrevePath(config.cloudreveBackupsPath))
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible probar la conexión con Cloudreve.") }
  }
}

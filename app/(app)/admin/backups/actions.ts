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
import { logger } from "@/lib/logger"
import {
  buildOrchestratorEnv,
  describeFailedStep,
  readBackupStatusForRun,
  successfulBackupCompletion,
} from "@/lib/services/backup-run"

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
      ...(scriptsPath ? [path.join(/*turbopackIgnore: true*/ scriptsPath, "backup-orchestrator.sh")] : []),
      path.resolve(/*turbopackIgnore: true*/ cwd, "scripts", "backup-orchestrator.sh"),
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
    // `BACKUP_DIR` es una ruta del host, no del almacenamiento de la app, así que estos
    // joins no pasan por `lib/storage`. Llevan el `turbopackIgnore` en línea —igual que
    // `lib/services/backups.ts`— porque sin él Turbopack los evalúa como patrón de archivo
    // y trazaba el proyecto entero: esta sola ruta metía los 10.230 archivos de `storage/`
    // en el artefacto de despliegue.
    const backupDir = process.env.BACKUP_DIR || "/srv/bodega/backups"
    await fs.mkdir(path.join(/*turbopackIgnore: true*/ backupDir, "snapshots"), { recursive: true })
    await fs.mkdir(path.join(/*turbopackIgnore: true*/ backupDir, "pg"), { recursive: true })

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

    // El mismo entorno que el respaldo diario: la whitelist completa (lo que
    // `env-config.tar.gz` guarda y la subida a Cloudreve necesita para abrir
    // sus credenciales) y no todo process.env.
    const env = buildOrchestratorEnv(process.env, {
      BACKUP_DIR: backupDir,
      BACKUP_RUN_ID: logId,
      APP_VERSION:
        process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
        process.env.APP_VERSION ||
        "manual",
      RETENTION_DAYS: String(backupCfg.retentionDays),
      DRIVE_BACKUP_ENABLED: String(backupCfg.driveBackupsEnabled),
      CLOUDREVE_BACKUP_ENABLED: String(backupCfg.cloudreveBackupsEnabled),
      CLOUDREVE_BACKUP_PATH: backupCfg.cloudreveBackupsPath,
    })

    try {
      await execFileAsync(orchestratorPath, [], {
        env: env as NodeJS.ProcessEnv,
        timeout: backupCfg.manualTimeoutMinutes * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      })
    } catch (err) {
      // El texto de `execFile` lleva la ruta del script y la pantalla lo
      // descarta: el motivo real está en el paso que el orquestador anotó.
      const failure = describeFailedStep(await readBackupStatusForRun(backupDir, logId))
      const stdout = (err as { stdout?: string }).stdout ?? ""
      logger.error("[admin/backups] el orquestador falló", {
        errorCode: failure.code,
        stdoutTail: stdout.split("\n").slice(-40).join("\n"),
      })
      await completeBackupLog(logId, {
        status: "failed",
        errorMessage: failure.message,
        errorCode: failure.code,
        appVersion: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "unknown",
        hostname: "manual-trigger",
      })
      revalidatePath("/admin/backups")
      return { ok: false, message: failure.message }
    }

    // ── 5. Registrar las métricas reales del manifiesto ───────────────────
    const status = await readBackupStatusForRun(backupDir, logId)
    const result = await successfulBackupCompletion({
      backupDir,
      status: status ?? { BACKUP_DATE: today },
      driveDest: process.env.GDRIVE_BACKUPS_DEST,
      cloudrevePath: backupCfg.cloudreveBackupsPath,
      appVersion: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "unknown",
    })

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

/**
 * lib/services/backups.ts — Servicio central de backups
 *
 * Proporciona:
 * - Consulta de estado de backups (historial, último, métricas)
 * - Registro de ejecuciones (crear, actualizar estado)
 * - Trigger manual de backup via Server Action
 * - Healthcheck para el panel admin
 */

import { db } from "@/db"
import { backupLog, backupSettings } from "@/db/schema"
import { desc, eq, and, lt } from "drizzle-orm"
import { nanoid } from "@/lib/id"
import { normalizeBackupCloudrevePath, DEFAULT_BACKUP_CLOUDREVE_PATH } from "@/lib/services/cloudreve/backup"

// ── Types ────────────────────────────────────────────────────────────────────

export interface BackupEntry {
  id:                string
  status:            "running" | "success" | "failed"
  backupDate:        string  // YYYY-MM-DD
  startedAt:         string
  completedAt:       string | null
  pgSizeBytes:       number | null
  pgSha256:          string | null
  storageSizeBytes:  number | null
  storageSha256:     string | null
  configSizeBytes:   number | null
  configSha256:      string | null
  manifestSha256:    string | null
  cloudrevePath:     string | null
  cloudreveUploaded: boolean | null
  appVersion:        string | null
  hostname:          string | null
  totalSizeBytes:    number | null
  errorMessage:      string | null
  errorCode:         string | null
  trigger:           "cron" | "manual" | "deploy"
  triggeredByUserId: string | null
}

export interface BackupStats {
  lastBackup:        BackupEntry | null
  lastSuccess:       BackupEntry | null
  lastFailed:        BackupEntry | null
  totalBackups:      number
  successCount:      number
  failedCount:       number
  runningCount:      number
  backupsLast7Days:  number
  successfulBackupsLast7Days: number
  totalSizeBytes:    number | null
  cloudreveUploaded: boolean
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createBackupLog(input: {
  backupDate: string
  trigger?: "cron" | "manual" | "deploy"
  triggeredByUserId?: string
  /** El respaldo diario se registra al terminar: trae su id de corrida y su hora real de inicio. */
  id?: string
  startedAt?: string
}): Promise<BackupEntry> {
  const id = input.id ?? nanoid()
  const now = input.startedAt ?? new Date().toISOString()

  const [row] = await db
    .insert(backupLog)
    .values({
      id,
      status: "running",
      backupDate: input.backupDate,
      startedAt: now,
      trigger: input.trigger ?? "cron",
      triggeredByUserId: input.triggeredByUserId ?? null,
    })
    .returning()

  return toEntry(row)
}

// ── Update status ────────────────────────────────────────────────────────────

export async function completeBackupLog(
  id: string,
  result: {
    status: "success" | "failed"
    pgSizeBytes?: number
    pgSha256?: string
    storageSizeBytes?: number
    storageSha256?: string
    configSizeBytes?: number
    configSha256?: string
    manifestSha256?: string
    cloudrevePath?: string
    cloudreveUploaded?: boolean
    appVersion?: string
    hostname?: string
    totalSizeBytes?: number
    errorMessage?: string
    errorCode?: string
  },
): Promise<void> {
  const now = new Date().toISOString()

  await db
    .update(backupLog)
    .set({
      status: result.status,
      completedAt: now,
      pgSizeBytes: result.pgSizeBytes ?? null,
      pgSha256: result.pgSha256 ?? null,
      storageSizeBytes: result.storageSizeBytes ?? null,
      storageSha256: result.storageSha256 ?? null,
      configSizeBytes: result.configSizeBytes ?? null,
      configSha256: result.configSha256 ?? null,
      manifestSha256: result.manifestSha256 ?? null,
      cloudrevePath: result.cloudrevePath ?? null,
      cloudreveUploaded: result.cloudreveUploaded ?? null,
      appVersion: result.appVersion ?? null,
      hostname: result.hostname ?? null,
      totalSizeBytes: result.totalSizeBytes ?? null,
      errorMessage: result.errorMessage ?? null,
      errorCode: result.errorCode ?? null,
    })
    .where(eq(backupLog.id, id))
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function getRecentBackups(limit = 30): Promise<BackupEntry[]> {
  const rows = await db
    .select()
    .from(backupLog)
    .orderBy(desc(backupLog.startedAt))
    .limit(limit)

  return rows.map(toEntry)
}

export async function getBackupById(id: string): Promise<BackupEntry | null> {
  const row = await db.query.backupLog.findFirst({
    where: eq(backupLog.id, id),
  })
  return row ? toEntry(row) : null
}

export async function getLatestBackup(): Promise<BackupEntry | null> {
  const [row] = await db
    .select()
    .from(backupLog)
    .orderBy(desc(backupLog.startedAt))
    .limit(1)

  return row ? toEntry(row) : null
}

export async function getBackupStats(): Promise<BackupStats> {
  const all = await db.select().from(backupLog)

  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const lastSuccess = all
    .filter((b) => b.status === "success")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null

  const lastFailed = all
    .filter((b) => b.status === "failed")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null

  const lastBackup = all
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null

  const last7Days = all.filter((b) => b.startedAt >= sevenDaysAgo)
  const successfulLast7Days = last7Days.filter((b) => b.status === "success")

  const lastBackupWithCloudreve = all
    .filter((b) => b.cloudreveUploaded)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null

  return {
    lastBackup: lastBackup ? toEntry(lastBackup) : null,
    lastSuccess: lastSuccess ? toEntry(lastSuccess) : null,
    lastFailed: lastFailed ? toEntry(lastFailed) : null,
    totalBackups: all.length,
    successCount: all.filter((b) => b.status === "success").length,
    failedCount: all.filter((b) => b.status === "failed").length,
    runningCount: all.filter((b) => b.status === "running").length,
    backupsLast7Days: last7Days.length,
    successfulBackupsLast7Days: successfulLast7Days.length,
    totalSizeBytes: lastSuccess?.totalSizeBytes ?? null,
    cloudreveUploaded: lastBackupWithCloudreve?.cloudreveUploaded ?? false,
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

export async function cleanupOldBackupLogs(retentionDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()

  const result = await db
    .delete(backupLog)
    .where(
      and(
        eq(backupLog.status, "success"),
        lt(backupLog.startedAt, cutoff),
      ),
    )
    .returning({ id: backupLog.id })

  return result.length
}

// ── Backup Settings (editable desde panel admin) ─────────────────────────────

export interface BackupConfig {
  backupHour: number
  retentionDays: number
  maxAgeHours: number
  manualTimeoutMinutes: number
  cloudreveBackupsEnabled: boolean
  cloudreveBackupsPath: string
}

export async function getBackupConfig(): Promise<BackupConfig> {
  const [row] = await db
    .select()
    .from(backupSettings)
    .where(eq(backupSettings.id, "default"))

  return {
    backupHour: row?.backupHour ?? 3,
    retentionDays: row?.retentionDays ?? 30,
    maxAgeHours: row?.maxAgeHours ?? 36,
    manualTimeoutMinutes: row?.manualTimeoutMinutes ?? 30,
    cloudreveBackupsEnabled: row?.cloudreveBackupsEnabled ?? false,
    cloudreveBackupsPath: normalizeBackupCloudrevePath(row?.cloudreveBackupsPath),
  }
}

export async function updateBackupConfig(input: Partial<BackupConfig>): Promise<BackupConfig> {
  const updates: Record<string, unknown> = {}

  if (input.backupHour !== undefined) {
    if (input.backupHour < 0 || input.backupHour > 23) {
      throw new Error("backupHour must be 0-23")
    }
    updates.backupHour = input.backupHour
  }
  if (input.retentionDays !== undefined) {
    if (input.retentionDays < 1 || input.retentionDays > 365) {
      throw new Error("retentionDays must be 1-365")
    }
    updates.retentionDays = input.retentionDays
  }
  if (input.maxAgeHours !== undefined) {
    if (input.maxAgeHours < 1 || input.maxAgeHours > 168) {
      throw new Error("maxAgeHours must be 1-168")
    }
    updates.maxAgeHours = input.maxAgeHours
  }
  if (input.manualTimeoutMinutes !== undefined) {
    if (input.manualTimeoutMinutes < 5 || input.manualTimeoutMinutes > 120) {
      throw new Error("manualTimeoutMinutes must be 5-120")
    }
    updates.manualTimeoutMinutes = input.manualTimeoutMinutes
  }
  if (input.cloudreveBackupsEnabled !== undefined) {
    if (typeof input.cloudreveBackupsEnabled !== "boolean") {
      throw new Error("cloudreveBackupsEnabled must be boolean")
    }
    updates.cloudreveBackupsEnabled = input.cloudreveBackupsEnabled
  }
  if (input.cloudreveBackupsPath !== undefined) {
    // Lanza ante traversal/backslash/control chars; guarda el path normalizado.
    updates.cloudreveBackupsPath = normalizeBackupCloudrevePath(input.cloudreveBackupsPath)
  }

  if (Object.keys(updates).length === 0) {
    return getBackupConfig()
  }

  updates.updatedAt = new Date().toISOString()

  await db
    .insert(backupSettings)
    .values({
      id: "default",
      backupHour: updates.backupHour ?? 3,
      retentionDays: updates.retentionDays ?? 30,
      maxAgeHours: updates.maxAgeHours ?? 36,
      manualTimeoutMinutes: updates.manualTimeoutMinutes ?? 30,
      cloudreveBackupsEnabled: updates.cloudreveBackupsEnabled ?? false,
      cloudreveBackupsPath: updates.cloudreveBackupsPath ?? DEFAULT_BACKUP_CLOUDREVE_PATH,
    } as typeof backupSettings.$inferInsert)
    .onConflictDoUpdate({
      target: backupSettings.id,
      set: updates as Record<string, unknown>,
    })

  return getBackupConfig()
}

// ── Helper ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEntry(row: any): BackupEntry {
  return {
    id:                row.id,
    status:            row.status,
    backupDate:        row.backupDate,
    startedAt:         row.startedAt,
    completedAt:       row.completedAt,
    pgSizeBytes:       row.pgSizeBytes,
    pgSha256:          row.pgSha256,
    storageSizeBytes:  row.storageSizeBytes,
    storageSha256:     row.storageSha256,
    configSizeBytes:   row.configSizeBytes,
    configSha256:      row.configSha256,
    manifestSha256:    row.manifestSha256,
    cloudrevePath:     row.cloudrevePath,
    cloudreveUploaded: row.cloudreveUploaded,
    appVersion:        row.appVersion,
    hostname:          row.hostname,
    totalSizeBytes:    row.totalSizeBytes,
    errorMessage:      row.errorMessage,
    errorCode:         row.errorCode,
    trigger:           row.trigger ?? "cron",
    triggeredByUserId: row.triggeredByUserId,
  }
}

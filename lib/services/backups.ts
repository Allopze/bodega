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
  drivePath:         string | null
  driveUploaded:     boolean | null
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
  totalSizeBytes:    number | null
  driveUploaded:     boolean
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createBackupLog(input: {
  backupDate: string
  trigger?: "cron" | "manual" | "deploy"
  triggeredByUserId?: string
}): Promise<BackupEntry> {
  const id = nanoid()
  const now = new Date().toISOString()

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
    drivePath?: string
    driveUploaded?: boolean
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
      drivePath: result.drivePath ?? null,
      driveUploaded: result.driveUploaded ?? null,
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

  const lastBackupWithDrive = all
    .filter((b) => b.driveUploaded)
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
    totalSizeBytes: lastSuccess?.totalSizeBytes ?? null,
    driveUploaded: lastBackupWithDrive?.driveUploaded ?? false,
  }
}

// ── Drive Health ─────────────────────────────────────────────────────────────

/** Resultado del healthcheck de conectividad con Google Drive */
export interface DriveHealth {
  /** ¿rclone está instalado en el sistema? */
  rcloneInstalled:  boolean
  /** ¿El remote `gdrive-backups:` está configurado en rclone? */
  remoteConfigured: boolean
  /** ¿Existe el archivo del Service Account JSON en alguna ruta esperada? */
  saJsonPresent:    boolean
  /** ¿El JSON del Service Account es sintácticamente válido y tiene los campos críticos? */
  saValid:          boolean
  /** Email del Service Account (cliente_email del JSON), si se pudo leer */
  saEmail:          string | null
  /** Ruta donde se encontró el SA JSON */
  saPath:           string | null
  /** Mensaje descriptivo sobre el estado del SA */
  saDetail:         string
  /** ¿Se pudo listar el destino remoto (conectividad real)? */
  reachable:        boolean
  /** Timestamp ISO de la última verificación */
  lastChecked:      string | null
  /** Ruta del archivo rclone.conf si existe */
  rcloneConfPath:   string | null
}

/**
 * Verifica la conectividad con Google Drive vía rclone.
 *
 * Ejecuta comandos rclone para determinar si:
 * 1. rclone está instalado
 * 2. El Service Account JSON existe y tiene campos válidos
 * 3. El remote gdrive-backups está configurado
 * 4. El destino es alcanzable (lsd real)
 *
 * Es best-effort: si algo falla, retorna el estado parcial.
 */
export async function getDriveHealth(): Promise<DriveHealth> {
  const result: DriveHealth = {
    rcloneInstalled:  false,
    remoteConfigured: false,
    saJsonPresent:    false,
    saValid:          false,
    saEmail:          null,
    saPath:           null,
    saDetail:         "No se pudo verificar",
    reachable:        false,
    lastChecked:      null,
    rcloneConfPath:   null,
  }

  try {
    const { execFile } = await import("node:child_process")
    const { promisify } = await import("node:util")
    const execFileAsync = promisify(execFile)
    const { existsSync, readFileSync } = await import("node:fs")

    // 1. Verificar archivo rclone.conf
    const home = process.env.HOME || "/root"
    const rcloneConfCandidates = [
      process.env.RCLONE_CONFIG || `${home}/.config/rclone/rclone.conf`,
    ]
    for (const p of rcloneConfCandidates) {
      if (existsSync(p)) {
        result.rcloneConfPath = p
        break
      }
    }

    // 2. Verificar Service Account JSON (existencia + validez)
    const saPaths = [
      "/srv/bodega/secrets/gdrive-service-account.json",
      `${home}/.config/rclone/gdrive-service-account.json`,
    ]
    for (const p of saPaths) {
      if (existsSync(p)) {
        result.saPath = p
        result.saJsonPresent = true

        // Validar contenido del JSON
        try {
          const raw = readFileSync(p, "utf-8")
          const parsed = JSON.parse(raw)

          const hasPrivateKey = typeof parsed.private_key === "string"
            && parsed.private_key.startsWith("-----BEGIN PRIVATE KEY-----")
          const hasClientEmail = typeof parsed.client_email === "string"
            && parsed.client_email.includes("iam.gserviceaccount.com")
          const hasTokenUri = typeof parsed.token_uri === "string"
            && parsed.token_uri === "https://oauth2.googleapis.com/token"

          result.saValid = hasPrivateKey && hasClientEmail && hasTokenUri
          result.saEmail = parsed.client_email || null

          if (!hasPrivateKey) {
            result.saDetail = "JSON sin private_key válida"
          } else if (!hasClientEmail) {
            result.saDetail = "JSON sin client_email de Service Account"
          } else if (!hasTokenUri) {
            result.saDetail = "JSON con token_uri incorrecto"
          } else {
            result.saDetail = "Válido"
          }
        } catch (parseErr) {
          result.saDetail = `Error al parsear JSON: ${parseErr instanceof Error ? parseErr.message.slice(0, 80) : "desconocido"}`
        }

        break
      }
    }

    if (!result.saJsonPresent) {
      result.saDetail = "Archivo no encontrado en las rutas esperadas"
    }

    // 3. ¿rclone instalado? (se necesita para los siguientes pasos)
    try {
      await execFileAsync("rclone", ["--version"], { timeout: 5000 })
      result.rcloneInstalled = true
    } catch {
      result.lastChecked = new Date().toISOString()
      return result // Sin rclone no hay más que verificar
    }

    // 4. ¿Remote gdrive-backups configurado?
    try {
      const { stdout } = await execFileAsync("rclone", ["listremotes"], { timeout: 5000 })
      result.remoteConfigured = stdout.includes("gdrive-backups:")
    } catch {
      result.lastChecked = new Date().toISOString()
      return result
    }

    // 5. Verificar conectividad real (listar bucket remoto)
    if (result.remoteConfigured) {
      try {
        await execFileAsync("rclone", ["lsd", "gdrive-backups:bodega-backups/"], { timeout: 10000 })
        result.reachable = true
      } catch {
        result.reachable = false
      }
    }

    result.lastChecked = new Date().toISOString()
  } catch {
    // Best-effort completo
  }

  return result
}
/**
 * Obtiene un resumen textual del estado del SA para mostrar en el panel.
 */
export function getSaStatusSummary(drive: DriveHealth | null): {
  label: string
  status: "success" | "failed" | "none"
  details: string[]
} {
  if (!drive) {
    return { label: "Sin verificar", status: "none", details: ["Healthcheck no disponible"] }
  }

  const details: string[] = []

  if (drive.saPath) {
    details.push(`Archivo: ${drive.saPath}`)
  } else {
    details.push("Archivo: no encontrado")
  }

  if (drive.saEmail) {
    details.push(`Email: ${drive.saEmail}`)
  }

  if (drive.saValid) {
    details.push("Private key: presente ✓")
    details.push("Token URI: correcto ✓")
  } else if (drive.saJsonPresent) {
    details.push(`⚠️ ${drive.saDetail}`)
  }

  if (drive.rcloneConfPath) {
    details.push(`rclone.conf: presente`)
  } else {
    details.push(`rclone.conf: no encontrado`)
  }

  if (drive.rcloneInstalled) {
    if (drive.remoteConfigured && drive.reachable) {
      details.push("Conectividad Drive: OK ✓")
    } else if (drive.remoteConfigured && !drive.reachable) {
      details.push("Conectividad Drive: error — verifica conectividad de red")
    }
  }

  if (drive.lastChecked) {
    const ago = Math.round((Date.now() - new Date(drive.lastChecked).getTime()) / 60000)
    details.push(`Verificado hace ${ago} min`)
  }

  // Estado general
  let status: "success" | "failed" | "none"
  let label: string

  if (!drive.saJsonPresent) {
    status = "failed"
    label = "No configurado"
  } else if (!drive.saValid) {
    status = "failed"
    label = "SA inválido"
  } else if (drive.reachable) {
    status = "success"
    label = "SA operativo"
  } else if (drive.remoteConfigured) {
    status = "none"
    label = "SA configurado, Drive inaccesible"
  } else {
    status = "none"
    label = "SA presente, remote no configurado"
  }

  return { label, status, details }
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
    drivePath:         row.drivePath,
    driveUploaded:     row.driveUploaded,
    appVersion:        row.appVersion,
    hostname:          row.hostname,
    totalSizeBytes:    row.totalSizeBytes,
    errorMessage:      row.errorMessage,
    errorCode:         row.errorCode,
    trigger:           row.trigger ?? "cron",
    triggeredByUserId: row.triggeredByUserId,
  }
}

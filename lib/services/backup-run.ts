/**
 * Lo que comparten las dos formas de correr `backup-orchestrator.sh`: el botón
 * «Respaldar ahora» (la app ejecuta el script) y el respaldo diario del
 * contenedor `backup-scheduler` (que después lo reporta a
 * `/api/cron/backup-report`).
 *
 * Antes cada camino armaba su entorno y leía su resultado por su cuenta, y se
 * separaron: el botón no le pasaba el keyring DTE al orquestador, así que la
 * subida a Cloudreve no podía abrir las credenciales y abortaba el respaldo; y
 * el diario nunca escribía en `backup_log`, así que `backup-health` avisaba
 * «sin respaldos» todos los días mientras había uno cada noche.
 */
import path from "node:path"
import fs from "node:fs/promises"
import type { completeBackupLog } from "@/lib/services/backups"

/**
 * Copia de `ENV_WHITELIST` de `scripts/backup-orchestrator.sh`: lo que el
 * orquestador guarda en `env-config.tar.gz`. Si no se reenvía, el `.env` del
 * snapshot sale sin esas llaves y el respaldo no se puede restaurar (no hay
 * otra copia de ellas). `backup-env-whitelist.test.ts` falla si las dos listas
 * se separan.
 */
export const ORCHESTRATOR_ENV_WHITELIST = [
  "NODE_ENV", "HOSTNAME", "TZ",
  "DATABASE_URL", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "PGHOST",
  "AUTH_SECRET", "AUTH_SECRET_PREVIOUS", "AUTH_URL", "NEXTAUTH_URL", "NEXTAUTH_SECRET",
  "PREVENTION_DATA_ENCRYPTION_KEY", "PREVENTION_DATA_ENCRYPTION_KEY_VERSION",
  "PREVENTION_ACK_TTL_DAYS", "PREVENTION_ACK_LEGACY_UNTIL",
  "APP_URL", "PDF_RENDER_ORIGIN",
  "RESEND_API_KEY",
  "STORAGE_PATH", "BACKUP_DIR", "BACKUP_SCRIPTS_PATH",
  "RETENTION_DAYS",
  "CRON_SECRET", "CRON_ALLOWED_SOURCES",
  "PDTP_EVIDENCE_GC_DELETE",
  "COPEC_USERNAME", "COPEC_PASSWORD", "COPEC_SYNC_START_DATE", "COPEC_SYNC_IMPORTER_EMAIL",
  "COPEC_OTP_IMAP_HOST", "COPEC_OTP_IMAP_PORT", "COPEC_OTP_IMAP_USER", "COPEC_OTP_IMAP_PASSWORD",
  "ARAMCO_DOCUMENT_NUMBER", "ARAMCO_PASSWORD", "ARAMCO_SYNC_ENABLED", "ARAMCO_SYNC_IMPORTER_EMAIL",
  "ONWAY_USERNAME", "ONWAY_PASSWORD", "ONWAY_SYNC_ENABLED",
  "SST_STORAGE_BACKEND", "CLOUDREVE_BASE_URL", "CLOUDREVE_USERNAME", "CLOUDREVE_PASSWORD",
  "CLOUDREVE_SST_PATH", "CLOUDREVE_REQUEST_TIMEOUT_MS",
  "GENERATED_DOCS_ARCHIVE_ENABLED",
  "TAX_RATE", "PDF_MAX_CONCURRENT", "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
  "TAE_OCR_MAX_CONCURRENT",
  "SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN", "SENTRY_ENVIRONMENT",
  "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
  "E2E_DATABASE_URL",
  "DTE_SETTINGS_KEYRING", "DTE_SETTINGS_ACTIVE_KEY_ID", "DTE_SETTINGS_MODE",
  "DTE_PORTAL_BASE_URL", "DTE_PORTAL_RUT_USR", "DTE_PORTAL_RUT_EMP",
  "DTE_PORTAL_CLAVE", "DTE_PORTAL_CODEMP",
  "DTE_SYNC_ENABLED", "DTE_SYNC_IMPORTER_EMAIL", "DTE_SYNC_DELAY_MS",
  "BILLING_SALES_SYNC_ENABLED", "BILLING_HISTORY_FLOOR",
  "BILLING_MATCH_AMOUNT_TOLERANCE_CLP", "BILLING_MATCH_DATE_WINDOW_DAYS",
  "BILLING_COMPANY_TAX_ID", "BILLING_CHIPAX_ENABLED", "BILLING_CHIPAX_SYNC_ENABLED",
  "CHIPAX_OPENAPI_URL", "CHIPAX_API_BASE_URL", "CHIPAX_APP_ID", "CHIPAX_SECRET_KEY",
  "CHIPAX_REQUEST_TIMEOUT_MS",
] as const

/**
 * Lo que el orquestador usa para operar sin guardarlo: la passphrase cifra el
 * snapshot (vacía = sin cifrar) y no puede viajar dentro de él.
 */
const ORCHESTRATOR_RUNTIME_ENV = [
  "BACKUP_ENCRYPTION_PASSPHRASE",
  "BACKUP_ALLOW_EMPTY_STORAGE",
  "HOME",
  "PATH",
] as const

/** Entorno del orquestador: la whitelist y el runtime, más lo que fija quien lo llama. */
export function buildOrchestratorEnv(
  source: Record<string, string | undefined>,
  overrides: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of [...ORCHESTRATOR_ENV_WHITELIST, ...ORCHESTRATOR_RUNTIME_ENV]) {
    const value = source[name]
    if (value !== undefined && value !== "") env[name] = value
  }
  env.HOME ??= "/root"
  env.PATH ??= "/usr/local/bin:/usr/bin:/bin"
  return { ...env, ...overrides }
}

// ── Resultado de una corrida ─────────────────────────────────────────────────

/** `${BACKUP_DIR}/.backup-status`, que el orquestador escribe al terminar (bien o mal). */
export type BackupStatusFile = Record<string, string>

export function parseBackupStatusFile(raw: string): BackupStatusFile {
  const result: BackupStatusFile = {}
  for (const line of raw.split("\n")) {
    const eq = line.indexOf("=")
    if (eq > 0) result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return result
}

/**
 * Lee el archivo de estado sólo si es el de esta corrida: si el orquestador
 * murió antes de escribirlo, el que queda es el de la corrida anterior y
 * atribuirlo a esta sería inventar un resultado.
 */
export async function readBackupStatusForRun(backupDir: string, runId: string): Promise<BackupStatusFile | null> {
  try {
    const raw = await fs.readFile(path.join(/*turbopackIgnore: true*/ backupDir, ".backup-status"), "utf-8")
    const status = parseBackupStatusFile(raw)
    return status.BACKUP_RUN_ID === runId ? status : null
  } catch {
    return null
  }
}

const FAILED_STEP_MESSAGES: Record<string, string> = {
  storage_precondition: "La carpeta de archivos adjuntos está vacía o no está montada.",
  pg_dump: "No se pudo copiar la base de datos.",
  storage_tar: "No se pudieron empaquetar los archivos adjuntos.",
  config_backup: "No se pudo respaldar la configuración del servidor.",
  encrypt_snapshot: "No se pudo cifrar el respaldo.",
  upload_remote: "Falló la subida a los destinos remotos.",
  upload_cloudreve: "Falló la subida a Cloudreve.",
  cleanup_local: "El respaldo se generó, pero falló la limpieza de copias locales antiguas.",
  cleanup_remote: "El respaldo se generó, pero falló la limpieza de copias remotas antiguas.",
}

/** Motivo legible del paso que falló; el código queda para `backup_log.error_code`. */
export function describeFailedStep(status: BackupStatusFile | null): { code: string; message: string } {
  const step = status?.BACKUP_FAILED_STEP
  if (!step || step === "unknown") {
    return { code: "BACKUP_FAILED", message: "El respaldo falló sin indicar en qué paso. Revise el log del servidor." }
  }
  let message = FAILED_STEP_MESSAGES[step] ?? `El respaldo falló en el paso «${step}».`
  // upload-backup-cloudreve sale con 2 cuando no hay credenciales utilizables.
  if (step === "upload_cloudreve" && status?.BACKUP_ERROR === "exit_code_2") {
    message = "Falló la subida a Cloudreve: no hay credenciales utilizables. Revise Administración › Almacenamiento de documentos."
  }
  return { code: `STEP_${step.toUpperCase()}`, message }
}

type BackupCompletion = Parameters<typeof completeBackupLog>[1]

/**
 * Métricas de un respaldo exitoso a partir de su `manifest.json` y del archivo
 * de estado. Las subidas se leen del estado (lo escribe el orquestador después
 * de cada destino), no del stdout: el diario no tiene stdout que mirar.
 */
export async function successfulBackupCompletion(input: {
  backupDir: string
  status: BackupStatusFile
  cloudrevePath: string
  appVersion: string
}): Promise<BackupCompletion> {
  const date = input.status.BACKUP_DATE ?? ""
  let manifest: Record<string, unknown> | null = null
  if (date) {
    try {
      const raw = await fs.readFile(
        path.join(/*turbopackIgnore: true*/ input.backupDir, "snapshots", date, "manifest.json"),
        "utf-8",
      )
      manifest = JSON.parse(raw)
    } catch { /* sin manifiesto: se registra el éxito sin métricas */ }
  }

  const c = manifest?.components as Record<string, Record<string, unknown>> | undefined
  const cloudreveUploaded = input.status.BACKUP_CLOUDREVE_UPLOADED === "true"

  return {
    status: "success",
    pgSizeBytes: (c?.postgres?.size_bytes as number) ?? undefined,
    pgSha256: (c?.postgres?.sha256 as string) ?? undefined,
    storageSizeBytes: (c?.storage?.size_bytes as number) ?? undefined,
    storageSha256: (c?.storage?.sha256 as string) ?? undefined,
    configSizeBytes: (c?.config?.size_bytes as number) ?? undefined,
    configSha256: (c?.config?.sha256 as string) ?? undefined,
    manifestSha256: input.status.BACKUP_MANIFEST_SHA256 || undefined,
    totalSizeBytes: (manifest?.total_size_bytes as number) ?? undefined,
    cloudreveUploaded,
    cloudrevePath: cloudreveUploaded ? `${input.cloudrevePath}/${date}` : undefined,
    appVersion: input.appVersion,
    hostname: ((manifest?.backup as Record<string, unknown>)?.hostname as string) ?? "",
  }
}

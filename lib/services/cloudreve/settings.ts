/**
 * Credenciales y configuración de Cloudreve (backend de storage de documentos SST).
 *
 * Mismo criterio que `lib/combustibles/aramco-settings.ts`: lo guardado en
 * `system_settings` (cifrado) manda, y el `.env` del servidor queda como
 * respaldo solo mientras el keyring esté en modo `compat`. El AAD de cada sobre
 * es la key física del setting (settings-crypto), así que un ciphertext de
 * otro campo no se puede reutilizar acá.
 *
 * La contraseña de la cuenta dedicada de Cloudreve es un secreto de servidor:
 * nunca viaja al cliente y solo se persiste cifrada.
 */

import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import {
  decryptDteSetting,
  encryptDteSetting,
  isEncryptedDteSetting,
  readDteSettingsKeyring,
} from "@/lib/services/dte-portal/settings-crypto"
import { normalizeCloudreveSstPath } from "./sst-path"

/** Keys en `system_settings`. */
export const CLOUDREVE_SETTING_KEYS = {
  baseUrl:  "storage.cloudreve.base_url",
  username: "storage.cloudreve.username",
  password: "storage.cloudreve.password",
  sstPath:  "storage.cloudreve.sst_path",
} as const

export type CloudreveSettingField = keyof typeof CLOUDREVE_SETTING_KEYS

/** Campos que se guardan cifrados y jamás cruzan al cliente. */
const SECRET_FIELDS = ["username", "password"] as const
type CloudreveSecretField = typeof SECRET_FIELDS[number]

export type CloudreveSettingSource = "system_settings" | "environment" | "missing"

export interface CloudreveConfig {
  baseUrl: string
  username: string
  password: string
  /** Carpeta remota dentro del WebDAV (default: storage/sst-documents). */
  sstPath: string
  hasCredentials: boolean
}

/** DTO seguro para el cliente: dice si hay valor, nunca cuál. */
export interface CloudreveAdminStatus {
  fields: Record<CloudreveSecretField, { configured: boolean; source: CloudreveSettingSource }>
  baseUrl: { configured: boolean; source: CloudreveSettingSource }
  sstPath: { configured: boolean; source: CloudreveSettingSource; value: string }
  hasStoredSettings: boolean
  /** False sin keyring: no se puede guardar, porque guardar en claro no es opción. */
  canStoreSecrets: boolean
}

export interface CloudreveSettingsInput {
  /** Vacío o ausente conserva el valor guardado. */
  baseUrl?: string
  username?: string
  password?: string
  /** Carpeta remota del espacio SST. Vacío conserva el valor guardado. */
  sstPath?: string
}

export class CloudreveSettingsError extends Error {
  constructor(readonly code: "CLOUDREVE_KEYRING_REQUIRED") {
    super(code)
    this.name = "CloudreveSettingsError"
  }
}

/* ── Lectura ─────────────────────────────────────────────────────────────── */

export function readCloudreveEnvConfig(): CloudreveConfig {
  const baseUrl = process.env.CLOUDREVE_BASE_URL?.trim() ?? ""
  const username = process.env.CLOUDREVE_USERNAME?.trim() ?? ""
  const password = process.env.CLOUDREVE_PASSWORD ?? ""
  const sstPath = normalizeCloudreveSstPath(process.env.CLOUDREVE_SST_PATH)
  return {
    baseUrl,
    username,
    password,
    sstPath,
    hasCredentials: Boolean(baseUrl && username && password),
  }
}

async function readRawSettings(): Promise<Partial<Record<CloudreveSettingField, string>>> {
  const rows = await db
    .select({ key: systemSettings.key, value: systemSettings.value })
    .from(systemSettings)
    .where(inArray(systemSettings.key, Object.values(CLOUDREVE_SETTING_KEYS)))

  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  const raw: Partial<Record<CloudreveSettingField, string>> = {}
  for (const [field, key] of Object.entries(CLOUDREVE_SETTING_KEYS) as [CloudreveSettingField, string][]) {
    const value = byKey.get(key)
    if (value !== undefined) raw[field] = value
  }
  return raw
}

/** Sobre cifrado presente que no se pudo abrir (keyring ausente o rotado). */
const UNREADABLE = Symbol("cloudreve-secret-unreadable")

/**
 * Un valor que no sea un sobre cifrado se ignora en vez de usarse: sólo puede
 * venir de una escritura a mano en la tabla, y aceptarlo convertiría un descuido
 * en credenciales en claro operando en silencio.
 */
function openSecret(value: string | undefined, settingKey: string): string | null | typeof UNREADABLE {
  if (value === undefined || value === "") return null
  if (!isEncryptedDteSetting(value)) {
    logger.warn("[storage/cloudreve] valor persistido sin cifrar, ignorado", { settingKey })
    return null
  }
  try {
    return decryptDteSetting(value, settingKey)
  } catch (error) {
    logger.warn("[storage/cloudreve] no se pudo descifrar un valor persistido", {
      settingKey,
      code: error instanceof Error ? error.message : "UNKNOWN",
    })
    return UNREADABLE
  }
}

function resolveSecret(stored: string | null | typeof UNREADABLE, fromEnv: string): string {
  if (stored === UNREADABLE) return ""
  return stored ?? fromEnv
}

/**
 * Configuración vigente: lo guardado, con el entorno de respaldo. Si la BD no
 * responde se cae al entorno en vez de dejar la integración «sin configurar».
 */
export async function readCloudreveConfig(): Promise<CloudreveConfig> {
  const env = readCloudreveEnvConfig()

  let raw: Partial<Record<CloudreveSettingField, string>>
  try {
    raw = await readRawSettings()
  } catch (error) {
    logger.warn("[storage/cloudreve] no se pudieron leer los ajustes persistidos", {
      message: error instanceof Error ? error.message : String(error),
    })
    return env
  }

  const baseUrl = (raw.baseUrl?.trim() || env.baseUrl).replace(/\/+$/, "")
  const username = resolveSecret(openSecret(raw.username, CLOUDREVE_SETTING_KEYS.username), env.username)
  const password = resolveSecret(openSecret(raw.password, CLOUDREVE_SETTING_KEYS.password), env.password)
  const sstPath = normalizeCloudreveSstPath(raw.sstPath ?? env.sstPath)

  return {
    baseUrl,
    username,
    password,
    sstPath,
    hasCredentials: Boolean(baseUrl && username && password),
  }
}

/** Estado para la pantalla: banderas y orígenes, sin un solo valor. */
export async function readCloudreveAdminStatus(): Promise<CloudreveAdminStatus> {
  const env = readCloudreveEnvConfig()

  let raw: Partial<Record<CloudreveSettingField, string>>
  try {
    raw = await readRawSettings()
  } catch {
    raw = {}
  }

  let canStoreSecrets = false
  try {
    canStoreSecrets = Boolean(readDteSettingsKeyring().activeKeyId)
  } catch {
    canStoreSecrets = false
  }

  const fields = Object.fromEntries(SECRET_FIELDS.map((field) => {
    const stored = openSecret(raw[field], CLOUDREVE_SETTING_KEYS[field])
    if (stored === UNREADABLE) {
      // Hay credencial guardada pero este servidor no puede abrirla: decir
      // «heredada del servidor» sería mentir sobre cuál está operando.
      return [field, { configured: false, source: "missing" as const }]
    }
    if (stored) return [field, { configured: true, source: "system_settings" as const }]
    const fromEnv = env[field]
    return [field, {
      configured: Boolean(fromEnv),
      source: (fromEnv ? "environment" : "missing") as CloudreveSettingSource,
    }]
  })) as CloudreveAdminStatus["fields"]

  const storedBaseUrl = raw.baseUrl?.trim()
  const storedSstPath = raw.sstPath !== undefined
    ? normalizeCloudreveSstPath(raw.sstPath)
    : null
  return {
    fields,
    baseUrl: storedBaseUrl
      ? { configured: true, source: "system_settings" as const }
      : { configured: Boolean(env.baseUrl), source: (env.baseUrl ? "environment" : "missing") as CloudreveSettingSource },
    sstPath: storedSstPath !== null
      ? { configured: true, source: "system_settings" as const, value: storedSstPath }
      : { configured: true, source: (process.env.CLOUDREVE_SST_PATH?.trim() ? "environment" : "missing") as CloudreveSettingSource, value: env.sstPath },
    hasStoredSettings: Object.keys(raw).length > 0,
    canStoreSecrets,
  }
}

/* ── Escritura ───────────────────────────────────────────────────────────── */

export interface CloudreveSettingsActor {
  userId: string
  userEmail?: string
}

/**
 * Un secreto vacío conserva el que ya estaba: evita que abrir el formulario y
 * guardar borre las credenciales sin querer. Sin keyring falla en vez de
 * persistir texto plano.
 */
export async function saveCloudreveSettings(
  input: CloudreveSettingsInput,
  actor: CloudreveSettingsActor,
): Promise<void> {
  const secrets = SECRET_FIELDS
    .map((field) => [field, input[field]?.trim() ?? ""] as const)
    .filter(([, value]) => value !== "")

  const writes: { key: string; value: string }[] = []
  const trimmedBaseUrl = input.baseUrl?.trim().replace(/\/+$/, "")
  if (trimmedBaseUrl) writes.push({ key: CLOUDREVE_SETTING_KEYS.baseUrl, value: trimmedBaseUrl })

  if (input.sstPath !== undefined) {
    // Valida la ruta al guardar para fallar temprano, no en el primer request.
    const normalizedSstPath = normalizeCloudreveSstPath(input.sstPath)
    writes.push({ key: CLOUDREVE_SETTING_KEYS.sstPath, value: normalizedSstPath })
  }

  if (secrets.length > 0) {
    let keyring
    try {
      keyring = readDteSettingsKeyring()
    } catch {
      throw new CloudreveSettingsError("CLOUDREVE_KEYRING_REQUIRED")
    }
    if (!keyring.activeKeyId) throw new CloudreveSettingsError("CLOUDREVE_KEYRING_REQUIRED")

    for (const [field, value] of secrets) {
      const key = CLOUDREVE_SETTING_KEYS[field]
      writes.push({ key, value: encryptDteSetting(value, key, keyring) })
    }
  }

  if (writes.length === 0) return

  const updatedAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    for (const write of writes) {
      await tx
        .insert(systemSettings)
        .values({ key: write.key, value: write.value, updatedAt })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: write.value, updatedAt } })
    }
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "cloudreve_storage_settings",
      entityId: "cloudreve",
      // Sólo qué cambió, nunca a qué.
      newState: {
        baseUrlUpdated: trimmedBaseUrl !== undefined,
        sstPathUpdated: input.sstPath !== undefined,
        usernameUpdated: secrets.some(([field]) => field === "username"),
        passwordUpdated: secrets.some(([field]) => field === "password"),
      },
    }, tx)
  })
}

/** Borra lo persistido y devuelve el mando al `.env` del servidor. */
export async function clearCloudreveSettings(actor: CloudreveSettingsActor): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(systemSettings).where(inArray(systemSettings.key, Object.values(CLOUDREVE_SETTING_KEYS)))
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "delete",
      entityType: "cloudreve_storage_settings",
      entityId: "cloudreve",
    }, tx)
  })
}

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
import { CLOUDREVE_SETTING_KEYS, type CloudreveSettingField } from "./setting-keys"

export { CLOUDREVE_SETTING_KEYS, type CloudreveSettingField } from "./setting-keys"

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
  backend: { value: SstBackendSetting; source: CloudreveSettingSource }
  /**
   * Backend que quedaría vigente si se borra lo persistido. NO siempre es
   * `filesystem`: con `SST_STORAGE_BACKEND=cloudreve` en el servidor, borrar la
   * configuración deja la biblioteca apuntando a Cloudreve. La pantalla lo
   * necesita para no prometer un rollback que no va a ocurrir.
   */
  fallbackBackend: SstBackendSetting
  hasStoredSettings: boolean
  /** False sin keyring: no se puede guardar, porque guardar en claro no es opción. */
  canStoreSecrets: boolean
}

export type SstBackendSetting = "filesystem" | "cloudreve"

export interface CloudreveSettingsInput {
  /** Vacío o ausente conserva el valor guardado. */
  baseUrl?: string
  username?: string
  password?: string
  /** Carpeta remota del espacio SST. Vacío conserva el valor guardado. */
  sstPath?: string
  /** Backend activo del espacio SST (no cifrado: es configuración, no secreto). */
  backend?: SstBackendSetting
  /** Borrado explícito de valores persistidos (checkbox en la pantalla). */
  clearUsername?: boolean
  clearPassword?: boolean
  clearSstPath?: boolean
}

export type CloudreveSettingsErrorCode =
  | "CLOUDREVE_KEYRING_REQUIRED"
  /** Activar el backend Cloudreve sin URL + usuario + contraseña vigentes. */
  | "CLOUDREVE_CREDENTIALS_REQUIRED"

export class CloudreveSettingsError extends Error {
  constructor(readonly code: CloudreveSettingsErrorCode) {
    super(code)
    this.name = "CloudreveSettingsError"
  }
}

/* ── Lectura ─────────────────────────────────────────────────────────────── */

/**
 * La URL base tiene que ser http(s) absoluta. Sin esta validación un valor como
 * `cloudreve.chome.cl` se persistía sin chistar y reventaba mucho después, como
 * un `TypeError: Invalid URL` crudo dentro de cada subida y descarga.
 */
export function assertValidCloudreveBaseUrl(raw: string): void {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error("La URL base de Cloudreve debe ser una dirección completa, por ejemplo https://cloudreve.chome.cl")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("La URL base de Cloudreve debe usar http:// o https://")
  }
}

/** Backend que el `.env` del servidor impone cuando no hay nada persistido. */
export function readEnvSstBackend(): SstBackendSetting {
  const raw = process.env.SST_STORAGE_BACKEND?.trim().toLowerCase()
  return raw === "cloudreve" || raw === "filesystem" ? raw : "filesystem"
}

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

  // Backend: system_settings → env → default filesystem.
  const storedBackend = raw.backend
  const envSetBackend = process.env.SST_STORAGE_BACKEND?.trim().toLowerCase()
  const backend: CloudreveAdminStatus["backend"] = storedBackend === "cloudreve" || storedBackend === "filesystem"
    ? { value: storedBackend, source: "system_settings" as const }
    : envSetBackend === "cloudreve" || envSetBackend === "filesystem"
      ? { value: envSetBackend, source: "environment" as const }
      : { value: "filesystem" as const, source: "missing" as const }

  // `configured` significa lo mismo en los cuatro campos: hay un valor efectivo
  // y de dónde sale. La carpeta remota lo declaraba siempre `true` —incluso con
  // `source: "missing"`—, y la pantalla ofrecía borrar algo que no existía.
  const envSstPathSet = Boolean(process.env.CLOUDREVE_SST_PATH?.trim())

  return {
    fields,
    baseUrl: storedBaseUrl
      ? { configured: true, source: "system_settings" as const }
      : { configured: Boolean(env.baseUrl), source: (env.baseUrl ? "environment" : "missing") as CloudreveSettingSource },
    sstPath: storedSstPath !== null
      ? { configured: true, source: "system_settings" as const, value: storedSstPath }
      : { configured: envSstPathSet, source: (envSstPathSet ? "environment" : "missing") as CloudreveSettingSource, value: env.sstPath },
    backend,
    fallbackBackend: readEnvSstBackend(),
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
 * ¿Quedarían URL + usuario + contraseña vigentes después de aplicar `input`?
 * Un campo vacío conserva lo que ya había, así que el estado resultante es la
 * mezcla de lo persistido con lo que trae este envío.
 */
async function willHaveCredentials(input: CloudreveSettingsInput): Promise<boolean> {
  const current = await readCloudreveConfig()
  const baseUrl = input.baseUrl?.trim().replace(/\/+$/, "") || current.baseUrl
  const username = input.clearUsername ? "" : (input.username?.trim() || current.username)
  const password = input.clearPassword ? "" : (input.password?.trim() || current.password)
  return Boolean(baseUrl && username && password)
}

/**
 * Un secreto vacío conserva el que ya estaba: evita que abrir el formulario y
 * guardar borre las credenciales sin querer. Sin keyring falla en vez de
 * persistir texto plano. Los borrados son explícitos por checkbox (clear*):
 * nunca se infieren de un campo vacío.
 */
export async function saveCloudreveSettings(
  input: CloudreveSettingsInput,
  actor: CloudreveSettingsActor,
): Promise<void> {
  const secrets = SECRET_FIELDS
    .map((field) => [field, input[field]?.trim() ?? ""] as const)
    .filter(([, value]) => value !== "")

  // Borrar y escribir el mismo campo en un envío es una orden contradictoria, y
  // la transacción la resolvía por orden de ejecución: los DELETE corren después
  // de los INSERT, así que la credencial recién escrita desaparecía en silencio.
  const conflicts = [
    input.clearUsername && input.username?.trim() ? "el usuario" : null,
    input.clearPassword && input.password?.trim() ? "la contraseña" : null,
    input.clearSstPath && input.sstPath?.trim() ? "la carpeta remota" : null,
  ].filter((label): label is string => label !== null)
  if (conflicts.length > 0) {
    throw new Error(`No se puede escribir y borrar ${conflicts.join(" y ")} en el mismo guardado: elija una de las dos acciones.`)
  }

  const deletes: string[] = []
  if (input.clearUsername) deletes.push(CLOUDREVE_SETTING_KEYS.username)
  if (input.clearPassword) deletes.push(CLOUDREVE_SETTING_KEYS.password)
  if (input.clearSstPath) deletes.push(CLOUDREVE_SETTING_KEYS.sstPath)

  const writes: { key: string; value: string }[] = []
  const trimmedBaseUrl = input.baseUrl?.trim().replace(/\/+$/, "")
  if (trimmedBaseUrl) {
    assertValidCloudreveBaseUrl(trimmedBaseUrl)
    writes.push({ key: CLOUDREVE_SETTING_KEYS.baseUrl, value: trimmedBaseUrl })
  }

  if (input.sstPath !== undefined && !input.clearSstPath) {
    // Valida la ruta al guardar para fallar temprano, no en el primer request.
    const normalizedSstPath = normalizeCloudreveSstPath(input.sstPath)
    writes.push({ key: CLOUDREVE_SETTING_KEYS.sstPath, value: normalizedSstPath })
  }

  if (input.backend !== undefined) {
    if (input.backend !== "filesystem" && input.backend !== "cloudreve") {
      throw new Error("Backend de almacenamiento inválido")
    }
    // Activar Cloudreve sin credenciales completas rompe TODA la biblioteca SST
    // al instante —cada subida y cada descarga—, así que se rechaza en vez de
    // avisar: se valida el estado resultante, no el guardado, para que activar
    // el backend y escribir las credenciales en el mismo envío sí funcione.
    if (input.backend === "cloudreve" && !(await willHaveCredentials(input))) {
      throw new CloudreveSettingsError("CLOUDREVE_CREDENTIALS_REQUIRED")
    }
    writes.push({ key: CLOUDREVE_SETTING_KEYS.backend, value: input.backend })
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

  if (writes.length === 0 && deletes.length === 0) return

  const updatedAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    for (const write of writes) {
      await tx
        .insert(systemSettings)
        .values({ key: write.key, value: write.value, updatedAt })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: write.value, updatedAt } })
    }
    if (deletes.length > 0) {
      await tx.delete(systemSettings).where(inArray(systemSettings.key, deletes))
    }
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "cloudreve_storage_settings",
      entityId: "cloudreve",
      // Sólo qué cambió, nunca a qué. Las banderas siguen a las escrituras
      // reales: un campo vacío conserva el valor y no es un cambio que auditar.
      newState: {
        baseUrlUpdated: Boolean(trimmedBaseUrl),
        sstPathUpdated: input.sstPath !== undefined && !input.clearSstPath,
        sstPathCleared: input.clearSstPath === true,
        backendUpdated: input.backend !== undefined,
        usernameUpdated: secrets.some(([field]) => field === "username"),
        usernameCleared: input.clearUsername === true,
        passwordUpdated: secrets.some(([field]) => field === "password"),
        passwordCleared: input.clearPassword === true,
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

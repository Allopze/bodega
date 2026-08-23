/**
 * Credenciales del portal Aramco Fleet (Esmax / plataforma ex-Petrobras).
 *
 * Mismo criterio que `lib/services/billing/chipax-settings.ts`: lo guardado en
 * `system_settings` (cifrado) manda, y el `.env` del servidor queda como
 * respaldo. La alternativa —sólo entorno, como hace Copec— obliga a editar el
 * `.env` y reiniciar el contenedor para rotar, y la clave de una tarjeta de
 * flota se rota.
 *
 * Ambos campos se tratan como secretos. El `documentNumber` es un RUT y por sí
 * solo no abre nada, pero es la mitad de una credencial: exponerlo en la UI
 * sólo sirve para filtrar qué cuenta está configurada.
 */

import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import {
  // El keyring es de la aplicación, no del portal DTE: el prefijo del nombre es
  // histórico. El AAD de cada sobre es la key física del setting, así que un
  // ciphertext de `dte.clave` no se puede reutilizar acá.
  decryptDteSetting,
  encryptDteSetting,
  isEncryptedDteSetting,
  readDteSettingsKeyring,
} from "@/lib/services/dte-portal/settings-crypto"

/** Keys en `system_settings`. */
export const ARAMCO_SETTING_KEYS = {
  documentNumber: "combustibles.aramco.document_number",
  password:       "combustibles.aramco.password",
  syncEnabled:    "combustibles.aramco.sync_enabled",
} as const

export type AramcoSettingField = keyof typeof ARAMCO_SETTING_KEYS

/** Campos que se guardan cifrados y jamás cruzan al cliente. */
const SECRET_FIELDS = ["documentNumber", "password"] as const
type AramcoSecretField = typeof SECRET_FIELDS[number]

export type AramcoSettingSource = "system_settings" | "environment" | "missing"

export interface AramcoConfig {
  documentNumber: string
  password: string
  /** Si el cron puede correr. El botón manual no lo consulta. */
  syncEnabled: boolean
  hasCredentials: boolean
}

/** DTO seguro para el cliente: dice si hay valor, nunca cuál. */
export interface AramcoAdminStatus {
  syncEnabled: boolean
  fields: Record<AramcoSecretField, { configured: boolean; source: AramcoSettingSource }>
  hasStoredSettings: boolean
  /** False sin keyring: no se puede guardar, porque guardar en claro no es opción. */
  canStoreSecrets: boolean
}

export interface AramcoSettingsInput {
  /** Vacío o ausente conserva el valor guardado. */
  documentNumber?: string
  password?: string
  syncEnabled: boolean
}

export class AramcoSettingsError extends Error {
  constructor(readonly code: "ARAMCO_KEYRING_REQUIRED") {
    super(code)
    this.name = "AramcoSettingsError"
  }
}

/* ── Lectura ─────────────────────────────────────────────────────────────── */

export function readAramcoEnvConfig(): AramcoConfig {
  const documentNumber = process.env.ARAMCO_DOCUMENT_NUMBER?.trim() ?? ""
  const password = process.env.ARAMCO_PASSWORD?.trim() ?? ""
  return {
    documentNumber,
    password,
    syncEnabled: process.env.ARAMCO_SYNC_ENABLED === "true",
    hasCredentials: Boolean(documentNumber && password),
  }
}

async function readRawSettings(): Promise<Partial<Record<AramcoSettingField, string>>> {
  const rows = await db
    .select({ key: systemSettings.key, value: systemSettings.value })
    .from(systemSettings)
    .where(inArray(systemSettings.key, Object.values(ARAMCO_SETTING_KEYS)))

  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  const raw: Partial<Record<AramcoSettingField, string>> = {}
  for (const [field, key] of Object.entries(ARAMCO_SETTING_KEYS) as [AramcoSettingField, string][]) {
    const value = byKey.get(key)
    if (value !== undefined) raw[field] = value
  }
  return raw
}

/** Sobre cifrado presente que no se pudo abrir (keyring ausente o rotado). */
const UNREADABLE = Symbol("aramco-secret-unreadable")

/**
 * Un valor que no sea un sobre cifrado se ignora en vez de usarse: sólo puede
 * venir de una escritura a mano en la tabla, y aceptarlo convertiría un descuido
 * en credenciales en claro operando en silencio.
 *
 * Un sobre ilegible NO es «no hay nada guardado»: caer al `.env` ahí significa
 * operar con la credencial ANTIGUA, la que la rotación vino a reemplazar.
 */
function openSecret(value: string | undefined, settingKey: string): string | null | typeof UNREADABLE {
  if (value === undefined || value === "") return null
  if (!isEncryptedDteSetting(value)) {
    logger.warn("[combustibles/aramco] valor persistido sin cifrar, ignorado", { settingKey })
    return null
  }
  try {
    return decryptDteSetting(value, settingKey)
  } catch (error) {
    logger.warn("[combustibles/aramco] no se pudo descifrar un valor persistido", {
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

function parseFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value === "true"
}

/**
 * Configuración vigente: lo guardado, con el entorno de respaldo. Si la BD no
 * responde se cae al entorno en vez de dejar la integración «sin configurar».
 */
export async function readAramcoConfig(): Promise<AramcoConfig> {
  const env = readAramcoEnvConfig()

  let raw: Partial<Record<AramcoSettingField, string>>
  try {
    raw = await readRawSettings()
  } catch (error) {
    logger.warn("[combustibles/aramco] no se pudieron leer los ajustes persistidos", {
      message: error instanceof Error ? error.message : String(error),
    })
    return env
  }

  const documentNumber = resolveSecret(openSecret(raw.documentNumber, ARAMCO_SETTING_KEYS.documentNumber), env.documentNumber)
  const password = resolveSecret(openSecret(raw.password, ARAMCO_SETTING_KEYS.password), env.password)

  return {
    documentNumber,
    password,
    syncEnabled: parseFlag(raw.syncEnabled, env.syncEnabled),
    hasCredentials: Boolean(documentNumber && password),
  }
}

/** Estado para la pantalla: banderas y orígenes, sin un solo valor. */
export async function readAramcoAdminStatus(): Promise<AramcoAdminStatus> {
  const env = readAramcoEnvConfig()

  let raw: Partial<Record<AramcoSettingField, string>>
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
    const stored = openSecret(raw[field], ARAMCO_SETTING_KEYS[field])
    if (stored === UNREADABLE) {
      // Hay credencial guardada pero este servidor no puede abrirla: decir
      // «heredada del servidor» sería mentir sobre cuál está operando.
      return [field, { configured: false, source: "missing" as const }]
    }
    if (stored) return [field, { configured: true, source: "system_settings" as const }]
    const fromEnv = env[field]
    return [field, {
      configured: Boolean(fromEnv),
      source: (fromEnv ? "environment" : "missing") as AramcoSettingSource,
    }]
  })) as AramcoAdminStatus["fields"]

  return {
    syncEnabled: parseFlag(raw.syncEnabled, env.syncEnabled),
    fields,
    hasStoredSettings: Object.keys(raw).length > 0,
    canStoreSecrets,
  }
}

/* ── Escritura ───────────────────────────────────────────────────────────── */

export interface AramcoSettingsActor {
  userId: string
  userEmail?: string
}

/**
 * Un secreto vacío conserva el que ya estaba: evita que abrir el formulario y
 * guardar borre las credenciales sin querer. Sin keyring falla en vez de
 * persistir texto plano.
 */
export async function saveAramcoSettings(
  input: AramcoSettingsInput,
  actor: AramcoSettingsActor,
): Promise<void> {
  const secrets = SECRET_FIELDS
    .map((field) => [field, input[field]?.trim() ?? ""] as const)
    .filter(([, value]) => value !== "")

  const writes: { key: string; value: string }[] = [
    { key: ARAMCO_SETTING_KEYS.syncEnabled, value: String(input.syncEnabled) },
  ]

  if (secrets.length > 0) {
    let keyring
    try {
      keyring = readDteSettingsKeyring()
    } catch {
      throw new AramcoSettingsError("ARAMCO_KEYRING_REQUIRED")
    }
    if (!keyring.activeKeyId) throw new AramcoSettingsError("ARAMCO_KEYRING_REQUIRED")

    for (const [field, value] of secrets) {
      const key = ARAMCO_SETTING_KEYS[field]
      writes.push({ key, value: encryptDteSetting(value, key, keyring) })
    }
  }

  const updatedAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    for (const write of writes) {
      await tx
        .insert(systemSettings)
        .values({ key: write.key, value: write.value, updatedAt })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: write.value, updatedAt } })
    }
    // La auditoría viaja con el cambio: fuera de la transacción, un fallo del
    // commit deja el secreto nuevo sin rastro de quién lo tocó.
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "combustibles_aramco_settings",
      entityId: "aramco",
      // Sólo qué cambió, nunca a qué.
      newState: {
        syncEnabled: input.syncEnabled,
        documentNumberUpdated: secrets.some(([field]) => field === "documentNumber"),
        passwordUpdated: secrets.some(([field]) => field === "password"),
      },
    }, tx)
  })
}

/** Borra lo persistido y devuelve el mando al `.env` del servidor. */
export async function clearAramcoSettings(actor: AramcoSettingsActor): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(systemSettings).where(inArray(systemSettings.key, Object.values(ARAMCO_SETTING_KEYS)))
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "delete",
      entityType: "combustibles_aramco_settings",
      entityId: "aramco",
    }, tx)
  })
}

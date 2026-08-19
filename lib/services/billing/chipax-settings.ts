/**
 * lib/services/billing/chipax-settings.ts
 *
 * Configuración de Chipax administrable desde la plataforma.
 *
 * ## Por qué existe
 *
 * Chipax era la única integración con credenciales que **no** se podía tocar sin
 * un despliegue: rotar la `secret_key` obligaba a editar el `.env` del servidor
 * y volver a levantar el contenedor. El portal DTE —la otra integración del
 * mismo tipo— ya se administra desde Administración › Sincronización DTE, con
 * los secretos cifrados en `system_settings`. Esto cierra esa asimetría reusando
 * exactamente el mismo sobre cifrado.
 *
 * ## Precedencia
 *
 * Lo guardado en `system_settings` **gana**; el entorno es el respaldo. Mientras
 * nadie guarde nada desde la UI la configuración vigente es idéntica a la de
 * antes, así que desplegar esto no cambia el comportamiento de producción.
 * «Restaurar configuración del servidor» borra las filas y devuelve el mando al
 * `.env`.
 *
 * ## Qué NO se administra acá
 *
 * `CHIPAX_API_BASE_URL`, `CHIPAX_OPENAPI_URL` y `CHIPAX_REQUEST_TIMEOUT_MS` son
 * decisiones de despliegue, no de operación, y siguen viviendo solo en el
 * entorno. `BILLING_COMPANY_TAX_ID` tampoco: es el RUT de la empresa, compartido
 * con el portal DTE.
 */

import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import {
  // El keyring es de la aplicación, no del portal DTE: el prefijo del nombre es
  // histórico. El AAD de cada sobre es la key física del setting, así que un
  // ciphertext de `dte.clave` no se puede reutilizar en `billing.chipax.*`.
  decryptDteSetting,
  encryptDteSetting,
  isEncryptedDteSetting,
  readDteSettingsKeyring,
} from "@/lib/services/dte-portal/settings-crypto"
import { readChipaxEnvConfig, type ChipaxConfig } from "./config"

/** Keys en `system_settings`. */
export const CHIPAX_SETTING_KEYS = {
  appId:       "billing.chipax.app_id",
  secretKey:   "billing.chipax.secret_key",
  enabled:     "billing.chipax.enabled",
  syncEnabled: "billing.chipax.sync_enabled",
} as const

export type ChipaxSettingField = keyof typeof CHIPAX_SETTING_KEYS

/** Campos que se guardan cifrados y jamás cruzan al cliente. */
const SECRET_FIELDS = ["appId", "secretKey"] as const
type ChipaxSecretField = typeof SECRET_FIELDS[number]

export type ChipaxSettingSource = "system_settings" | "environment" | "missing"

/** DTO seguro para el cliente: dice si hay valor, nunca cuál. */
export interface ChipaxAdminStatus {
  enabled: boolean
  syncEnabled: boolean
  fields: Record<ChipaxSecretField, { configured: boolean; source: ChipaxSettingSource }>
  /** True si hay al menos una fila persistida (habilita el botón de restaurar). */
  hasStoredSettings: boolean
  /**
   * False cuando el keyring de la aplicación no está disponible: sin él no se
   * pueden guardar credenciales, porque guardarlas en claro no es una opción.
   */
  canStoreSecrets: boolean
}

export interface ChipaxSettingsInput {
  /** Vacío o ausente conserva el valor guardado. */
  appId?: string
  secretKey?: string
  enabled: boolean
  syncEnabled: boolean
}

export class ChipaxSettingsError extends Error {
  constructor(readonly code: "CHIPAX_KEYRING_REQUIRED") {
    // El código es seguro para logs y para la respuesta: nunca lleva el valor.
    super(code)
    this.name = "ChipaxSettingsError"
  }
}

/* ── Lectura ─────────────────────────────────────────────────────────────── */

async function readRawChipaxSettings(): Promise<Partial<Record<ChipaxSettingField, string>>> {
  const rows = await db
    .select({ key: systemSettings.key, value: systemSettings.value })
    .from(systemSettings)
    .where(inArray(systemSettings.key, Object.values(CHIPAX_SETTING_KEYS)))

  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  const raw: Partial<Record<ChipaxSettingField, string>> = {}
  for (const [field, key] of Object.entries(CHIPAX_SETTING_KEYS) as [ChipaxSettingField, string][]) {
    const value = byKey.get(key)
    if (value !== undefined) raw[field] = value
  }
  return raw
}

/**
 * Abre un secreto persistido.
 *
 * Un valor que no sea un sobre cifrado se ignora en vez de usarse: sólo puede
 * venir de una escritura a mano en la tabla, y aceptarlo convertiría un descuido
 * en credenciales en claro operando en silencio.
 */
function openSecret(value: string | undefined, settingKey: string): string | null {
  if (value === undefined || value === "") return null
  if (!isEncryptedDteSetting(value)) {
    logger.warn("[billing/chipax] valor persistido sin cifrar, ignorado", { settingKey })
    return null
  }
  try {
    return decryptDteSetting(value, settingKey)
  } catch (error) {
    logger.warn("[billing/chipax] no se pudo descifrar un valor persistido", {
      settingKey,
      code: error instanceof Error ? error.message : "UNKNOWN",
    })
    return null
  }
}

function parseFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value === "true"
}

/**
 * Configuración vigente de Chipax: lo guardado, con el entorno de respaldo.
 *
 * Es asíncrona porque consulta `system_settings`. Si la BD no responde se cae al
 * entorno y se avisa: dejar a Chipax "sin configurar" por una caída de Postgres
 * apagaría una integración que el `.env` sí puede sostener.
 */
export async function readChipaxConfig(): Promise<ChipaxConfig> {
  const env = readChipaxEnvConfig()

  let raw: Partial<Record<ChipaxSettingField, string>>
  try {
    raw = await readRawChipaxSettings()
  } catch (error) {
    logger.warn("[billing/chipax] no se pudieron leer los ajustes persistidos", {
      message: error instanceof Error ? error.message : String(error),
    })
    return env
  }

  const appId = openSecret(raw.appId, CHIPAX_SETTING_KEYS.appId) ?? env.appId
  const secretKey = openSecret(raw.secretKey, CHIPAX_SETTING_KEYS.secretKey) ?? env.secretKey

  return {
    ...env,
    enabled: parseFlag(raw.enabled, env.enabled),
    syncEnabled: parseFlag(raw.syncEnabled, env.syncEnabled),
    appId,
    secretKey,
    hasCredentials: Boolean(appId && secretKey),
  }
}

/** Estado para la pantalla: banderas y orígenes, sin un solo valor. */
export async function readChipaxAdminStatus(): Promise<ChipaxAdminStatus> {
  const env = readChipaxEnvConfig()

  let raw: Partial<Record<ChipaxSettingField, string>>
  try {
    raw = await readRawChipaxSettings()
  } catch {
    raw = {}
  }

  let canStoreSecrets = false
  try {
    canStoreSecrets = Boolean(readDteSettingsKeyring().activeKeyId)
  } catch {
    // Keyring mal formado: el operador necesita saber que no puede guardar, no
    // el detalle del error de configuración del host.
    canStoreSecrets = false
  }

  const fields = Object.fromEntries(SECRET_FIELDS.map((field) => {
    const stored = openSecret(raw[field], CHIPAX_SETTING_KEYS[field])
    if (stored) return [field, { configured: true, source: "system_settings" as const }]
    const fromEnv = env[field]
    return [field, {
      configured: Boolean(fromEnv),
      source: (fromEnv ? "environment" : "missing") as ChipaxSettingSource,
    }]
  })) as ChipaxAdminStatus["fields"]

  return {
    enabled: parseFlag(raw.enabled, env.enabled),
    syncEnabled: parseFlag(raw.syncEnabled, env.syncEnabled),
    fields,
    hasStoredSettings: Object.keys(raw).length > 0,
    canStoreSecrets,
  }
}

/* ── Escritura ───────────────────────────────────────────────────────────── */

export interface ChipaxSettingsActor {
  userId: string
  userEmail?: string
}

/**
 * Guarda lo que el formulario mandó.
 *
 * Un secreto vacío conserva el que ya estaba: es la misma regla del portal DTE y
 * evita que abrir el formulario y guardar borre las credenciales sin querer. Sin
 * keyring la operación falla en vez de persistir texto plano.
 */
export async function saveChipaxSettings(
  input: ChipaxSettingsInput,
  actor: ChipaxSettingsActor,
): Promise<void> {
  const secrets = SECRET_FIELDS
    .map((field) => [field, input[field]?.trim() ?? ""] as const)
    .filter(([, value]) => value !== "")

  const writes: { key: string; value: string }[] = [
    { key: CHIPAX_SETTING_KEYS.enabled, value: String(input.enabled) },
    { key: CHIPAX_SETTING_KEYS.syncEnabled, value: String(input.syncEnabled) },
  ]

  if (secrets.length > 0) {
    let keyring
    try {
      keyring = readDteSettingsKeyring()
    } catch {
      throw new ChipaxSettingsError("CHIPAX_KEYRING_REQUIRED")
    }
    if (!keyring.activeKeyId) throw new ChipaxSettingsError("CHIPAX_KEYRING_REQUIRED")

    for (const [field, value] of secrets) {
      const key = CHIPAX_SETTING_KEYS[field]
      writes.push({ key, value: encryptDteSetting(value, key, keyring) })
    }
  }

  const updatedAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    for (const write of writes) {
      await tx
        .insert(systemSettings)
        .values({ key: write.key, value: write.value, updatedAt })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: write.value, updatedAt },
        })
    }
  })

  await recordAudit({
    userId: actor.userId,
    userEmail: actor.userEmail,
    action: "update",
    entityType: "billing_chipax_settings",
    entityId: "chipax",
    // Sólo qué cambió, nunca a qué. El valor de un secreto no entra al log de
    // auditoría ni siquiera truncado.
    newState: {
      enabled: input.enabled,
      syncEnabled: input.syncEnabled,
      appIdUpdated: secrets.some(([field]) => field === "appId"),
      secretKeyUpdated: secrets.some(([field]) => field === "secretKey"),
    },
  })
}

/** Borra lo persistido y devuelve el mando al `.env` del servidor. */
export async function clearChipaxSettings(actor: ChipaxSettingsActor): Promise<void> {
  await db
    .delete(systemSettings)
    .where(inArray(systemSettings.key, Object.values(CHIPAX_SETTING_KEYS)))

  await recordAudit({
    userId: actor.userId,
    userEmail: actor.userEmail,
    action: "delete",
    entityType: "billing_chipax_settings",
    entityId: "chipax",
  })
}

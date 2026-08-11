/**
 * Cifrado de los valores sensibles de configuración DTE.
 *
 * El contenido se guarda como `enc:v1:<kid>:<iv>:<tag>:<ciphertext>`. El AAD
 * es la key física de `system_settings`, de modo que copiar un ciphertext de
 * `dte.clave` a otro campo deja de ser válido.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ENVELOPE_PREFIX = "enc"
const ENVELOPE_VERSION = "v1"
const IV_LENGTH = 12
const TAG_LENGTH = 16
const KEY_LENGTH = 32
const BASE64URL = /^[A-Za-z0-9_-]+$/
const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/

export type DteSettingsEncryptionMode = "compat" | "encrypted_only"

export interface DteSettingsKeyring {
  mode: DteSettingsEncryptionMode
  activeKeyId: string | null
  keys: ReadonlyMap<string, Buffer>
}

export class DteSettingsCryptoError extends Error {
  constructor(readonly code:
    | "DTE_SETTINGS_MODE_INVALID"
    | "DTE_SETTINGS_KEYRING_REQUIRED"
    | "DTE_SETTINGS_KEYRING_INVALID"
    | "DTE_SETTINGS_KEY_INVALID"
    | "DTE_SETTINGS_ACTIVE_KEY_REQUIRED"
    | "DTE_SETTINGS_ACTIVE_KEY_INVALID"
    | "DTE_SETTINGS_ENVELOPE_INVALID"
    | "DTE_SETTINGS_KEY_UNAVAILABLE"
    | "DTE_SETTINGS_DECRYPT_FAILED",
  ) {
    // El código es seguro para logs y respuestas internas; nunca incluye el
    // valor cifrado, la clave de cifrado ni el secreto que no pudo abrirse.
    super(code)
    this.name = "DteSettingsCryptoError"
  }
}

interface DteSettingsCryptoEnvironment {
  DTE_SETTINGS_KEYRING?: string
  DTE_SETTINGS_ACTIVE_KEY_ID?: string
  DTE_SETTINGS_MODE?: string
}

/** Lee y valida el keyring inyectado solo al proceso de aplicación. */
export function readDteSettingsKeyring(): DteSettingsKeyring {
  // Project ambient types deliberately declare only a narrow subset of
  // ProcessEnv. Project the three allowed values instead of widening the
  // parser to all process state (and keep the keyring boundary explicit).
  return parseDteSettingsKeyring({
    DTE_SETTINGS_KEYRING: process.env.DTE_SETTINGS_KEYRING,
    DTE_SETTINGS_ACTIVE_KEY_ID: process.env.DTE_SETTINGS_ACTIVE_KEY_ID,
    DTE_SETTINGS_MODE: process.env.DTE_SETTINGS_MODE,
  })
}

/** Visible para pruebas y para comprobaciones de configuración de despliegue. */
export function parseDteSettingsKeyring(env: DteSettingsCryptoEnvironment): DteSettingsKeyring {
  const rawMode = env.DTE_SETTINGS_MODE?.trim() || "compat"
  if (rawMode !== "compat" && rawMode !== "encrypted_only") {
    throw new DteSettingsCryptoError("DTE_SETTINGS_MODE_INVALID")
  }

  const rawKeyring = env.DTE_SETTINGS_KEYRING?.trim()
  const activeKeyId = env.DTE_SETTINGS_ACTIVE_KEY_ID?.trim() || null
  if (!rawKeyring) {
    if (rawMode === "encrypted_only") {
      throw new DteSettingsCryptoError("DTE_SETTINGS_KEYRING_REQUIRED")
    }
    if (activeKeyId) {
      throw new DteSettingsCryptoError("DTE_SETTINGS_KEYRING_INVALID")
    }
    return { mode: rawMode, activeKeyId: null, keys: new Map() }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawKeyring)
  } catch {
    throw new DteSettingsCryptoError("DTE_SETTINGS_KEYRING_INVALID")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DteSettingsCryptoError("DTE_SETTINGS_KEYRING_INVALID")
  }

  const keys = new Map<string, Buffer>()
  for (const [keyId, encodedKey] of Object.entries(parsed)) {
    if (!KEY_ID.test(keyId) || typeof encodedKey !== "string") {
      throw new DteSettingsCryptoError("DTE_SETTINGS_KEYRING_INVALID")
    }
    const key = decodeBase64Url(encodedKey)
    if (!key || key.length !== KEY_LENGTH) {
      throw new DteSettingsCryptoError("DTE_SETTINGS_KEY_INVALID")
    }
    keys.set(keyId, key)
  }

  if (keys.size === 0) {
    throw new DteSettingsCryptoError("DTE_SETTINGS_KEYRING_INVALID")
  }
  if (!activeKeyId) {
    throw new DteSettingsCryptoError("DTE_SETTINGS_ACTIVE_KEY_REQUIRED")
  }
  if (!KEY_ID.test(activeKeyId) || !keys.has(activeKeyId)) {
    throw new DteSettingsCryptoError("DTE_SETTINGS_ACTIVE_KEY_INVALID")
  }

  return { mode: rawMode, activeKeyId, keys }
}

export function isEncryptedDteSetting(value: string | undefined): boolean {
  return Boolean(value?.startsWith(`${ENVELOPE_PREFIX}:${ENVELOPE_VERSION}:`))
}

/** Cifra un valor bajo la key física del setting, con AES-256-GCM y IV de 96 bits. */
export function encryptDteSetting(value: string, settingKey: string, keyring = readDteSettingsKeyring()): string {
  const activeKeyId = keyring.activeKeyId
  const key = activeKeyId ? keyring.keys.get(activeKeyId) : undefined
  if (!activeKeyId || !key) {
    throw new DteSettingsCryptoError("DTE_SETTINGS_ACTIVE_KEY_INVALID")
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(Buffer.from(settingKey, "utf8"))
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    ENVELOPE_PREFIX,
    ENVELOPE_VERSION,
    activeKeyId,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":")
}

/** Abre un sobre cifrado. Nunca devuelve plaintext cuando falla la autenticación. */
export function decryptDteSetting(value: string, settingKey: string, keyring = readDteSettingsKeyring()): string {
  const [prefix, version, keyId, encodedIv, encodedTag, encodedCiphertext, ...rest] = value.split(":")
  if (
    prefix !== ENVELOPE_PREFIX ||
    version !== ENVELOPE_VERSION ||
    !keyId ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    rest.length > 0 ||
    !KEY_ID.test(keyId)
  ) {
    throw new DteSettingsCryptoError("DTE_SETTINGS_ENVELOPE_INVALID")
  }

  const key = keyring.keys.get(keyId)
  if (!key) {
    throw new DteSettingsCryptoError("DTE_SETTINGS_KEY_UNAVAILABLE")
  }
  const iv = decodeBase64Url(encodedIv)
  const tag = decodeBase64Url(encodedTag)
  const ciphertext = decodeBase64Url(encodedCiphertext)
  if (!iv || !tag || !ciphertext || iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH || ciphertext.length === 0) {
    throw new DteSettingsCryptoError("DTE_SETTINGS_ENVELOPE_INVALID")
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAAD(Buffer.from(settingKey, "utf8"))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
  } catch {
    throw new DteSettingsCryptoError("DTE_SETTINGS_DECRYPT_FAILED")
  }
}

function decodeBase64Url(value: string): Buffer | null {
  if (!BASE64URL.test(value)) return null
  try {
    return Buffer.from(value, "base64url")
  } catch {
    return null
  }
}

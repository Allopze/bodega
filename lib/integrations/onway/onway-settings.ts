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

export const ONWAY_SETTING_KEYS = {
  username: "flota.onway.username",
  password: "flota.onway.password",
  syncEnabled: "flota.onway.sync_enabled",
} as const

type OnwaySettingField = keyof typeof ONWAY_SETTING_KEYS
type SecretField = "username" | "password"
const SECRET_FIELDS: SecretField[] = ["username", "password"]
const UNREADABLE = Symbol("onway-secret-unreadable")

export interface OnwayConfig {
  username: string
  password: string
  syncEnabled: boolean
  hasCredentials: boolean
}

export interface OnwayAdminStatus {
  syncEnabled: boolean
  hasCredentials: boolean
  hasStoredSettings: boolean
  canStoreSecrets: boolean
  fields: Record<SecretField, { configured: boolean; source: "system_settings" | "environment" | "missing" }>
}

export class OnwaySettingsError extends Error {
  constructor(readonly code: "ONWAY_KEYRING_REQUIRED") {
    super(code)
    this.name = "OnwaySettingsError"
  }
}

function readEnv(): OnwayConfig {
  const username = process.env.ONWAY_USERNAME?.trim() ?? ""
  const password = process.env.ONWAY_PASSWORD ?? ""
  return {
    username,
    password,
    syncEnabled: process.env.ONWAY_SYNC_ENABLED === "true",
    hasCredentials: Boolean(username && password),
  }
}

async function readRawSettings(): Promise<Partial<Record<OnwaySettingField, string>>> {
  const rows = await db.select({ key: systemSettings.key, value: systemSettings.value })
    .from(systemSettings)
    .where(inArray(systemSettings.key, Object.values(ONWAY_SETTING_KEYS)))
  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  return Object.fromEntries(
    (Object.entries(ONWAY_SETTING_KEYS) as Array<[OnwaySettingField, string]>)
      .flatMap(([field, key]) => byKey.has(key) ? [[field, byKey.get(key)!] as const] : []),
  )
}

function openSecret(value: string | undefined, key: string): string | null | typeof UNREADABLE {
  if (!value) return null
  if (!isEncryptedDteSetting(value)) {
    logger.warn("[flota/onway] valor persistido sin cifrar ignorado", { settingKey: key })
    return null
  }
  try {
    return decryptDteSetting(value, key)
  } catch (error) {
    logger.warn("[flota/onway] secreto persistido ilegible", {
      settingKey: key,
      code: error instanceof Error ? error.message : "UNKNOWN",
    })
    return UNREADABLE
  }
}

function resolvedSecret(stored: string | null | typeof UNREADABLE, fallback: string): string {
  return stored === UNREADABLE ? "" : (stored ?? fallback)
}

export async function readOnwayConfig(): Promise<OnwayConfig> {
  const env = readEnv()
  let raw: Partial<Record<OnwaySettingField, string>>
  try { raw = await readRawSettings() }
  catch {
    return env
  }

  const username = resolvedSecret(openSecret(raw.username, ONWAY_SETTING_KEYS.username), env.username)
  const password = resolvedSecret(openSecret(raw.password, ONWAY_SETTING_KEYS.password), env.password)
  return {
    username,
    password,
    syncEnabled: raw.syncEnabled === undefined ? env.syncEnabled : raw.syncEnabled === "true",
    hasCredentials: Boolean(username && password),
  }
}

export async function readOnwayAdminStatus(): Promise<OnwayAdminStatus> {
  const env = readEnv()
  let raw: Partial<Record<OnwaySettingField, string>>
  try { raw = await readRawSettings() }
  catch { raw = {} }

  let canStoreSecrets = false
  try { canStoreSecrets = Boolean(readDteSettingsKeyring().activeKeyId) }
  catch { canStoreSecrets = false }

  const fields = Object.fromEntries(SECRET_FIELDS.map((field) => {
    const stored = openSecret(raw[field], ONWAY_SETTING_KEYS[field])
    if (stored === UNREADABLE) return [field, { configured: false, source: "missing" as const }]
    if (stored) return [field, { configured: true, source: "system_settings" as const }]
    const configured = Boolean(env[field])
    return [field, { configured, source: configured ? "environment" as const : "missing" as const }]
  })) as OnwayAdminStatus["fields"]

  return {
    syncEnabled: raw.syncEnabled === undefined ? env.syncEnabled : raw.syncEnabled === "true",
    hasCredentials: fields.username.configured && fields.password.configured,
    hasStoredSettings: Object.keys(raw).length > 0,
    canStoreSecrets,
    fields,
  }
}

export async function saveOnwaySettings(
  input: { username?: string; password?: string; syncEnabled: boolean },
  actor: { userId: string; userEmail?: string },
): Promise<void> {
  const secrets: Array<[SecretField, string]> = []
  const username = input.username?.trim() ?? ""
  const password = input.password ?? ""
  if (username) secrets.push(["username", username])
  if (password) secrets.push(["password", password])

  const writes: Array<{ key: string; value: string }> = [
    { key: ONWAY_SETTING_KEYS.syncEnabled, value: String(input.syncEnabled) },
  ]
  if (secrets.length > 0) {
    let keyring
    try { keyring = readDteSettingsKeyring() }
    catch { throw new OnwaySettingsError("ONWAY_KEYRING_REQUIRED") }
    if (!keyring.activeKeyId) throw new OnwaySettingsError("ONWAY_KEYRING_REQUIRED")
    for (const [field, value] of secrets) {
      const key = ONWAY_SETTING_KEYS[field]
      writes.push({ key, value: encryptDteSetting(value, key, keyring) })
    }
  }

  const updatedAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    for (const write of writes) {
      await tx.insert(systemSettings).values({ ...write, updatedAt })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: write.value, updatedAt } })
    }
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "fleet_onway_settings",
      entityId: "onway",
      newState: {
        syncEnabled: input.syncEnabled,
        usernameUpdated: Boolean(username),
        passwordUpdated: Boolean(password),
      },
    }, tx)
  })
}

export async function clearOnwaySettings(actor: { userId: string; userEmail?: string }): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(systemSettings).where(inArray(systemSettings.key, Object.values(ONWAY_SETTING_KEYS)))
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "delete",
      entityType: "fleet_onway_settings",
      entityId: "onway",
    }, tx)
  })
}

/**
 * Configuración persistida del portal DTE.
 *
 * Los secretos no salen de esta capa: los valores sensibles se cifran con el
 * keyring de la aplicación cuando está configurado y el DTO para Admin sólo
 * expone banderas. `compat` permite leer registros legacy temporalmente;
 * `encrypted_only` nunca vuelve a usar DTE_PORTAL_* como fallback.
 */

import { db } from "@/db"
import { dtePortalOperationLeases, systemSettings } from "@/db/schema"
import { eq, gte, inArray, like, or, sql } from "drizzle-orm"
import { recordAudit } from "@/lib/audit"
import { CHIPAX_SETTING_KEYS } from "@/lib/services/billing/chipax-settings"
import {
  decryptDteSetting,
  encryptDteSetting,
  isEncryptedDteSetting,
  readDteSettingsKeyring,
  type DteSettingsEncryptionMode,
} from "./settings-crypto"

/** Keys in `system_settings`. `baseUrl` is retained only to clean legacy data. */
export const DTE_SETTING_KEYS = {
  baseUrl:       "dte.base_url",
  rutUsr:        "dte.rut_usr",
  rutEmp:        "dte.rut_emp",
  clave:         "dte.clave",
  codEmp:        "dte.cod_emp",
  syncEnabled:   "dte.sync_enabled",
  /** Independent fence used only while conversion/keyring re-cipher is in progress. */
  syncStartBarrier: "dte.sync_start_barrier",
  delayMs:       "dte.sync_delay_ms",
  importerEmail: "dte.sync_importer_email",
  /** Durable cutover barrier; only the controlled conversion may write it. */
  encryptionMode: "dte.encryption_mode",
} as const

export type DteSettingField = keyof typeof DTE_SETTING_KEYS
export type DteSensitiveSettingField = "rutUsr" | "rutEmp" | "clave" | "codEmp" | "importerEmail"

const DTE_KEY_PREFIX = "dte.%"
const ENCRYPTED_ONLY = "encrypted_only"
export const DTE_SYNC_START_BARRIER_PAUSED = "paused"
/** Transient, non-resumable state while conversion/keyring re-cipher owns the fence. */
export const DTE_SYNC_START_BARRIER_CUTOVER = "cutover"
export const DTE_SYNC_START_BARRIER_ACTIVE = "active"
/** Shared fence for conversion, settings writes, and sync starts. */
export const DTE_SETTINGS_ADVISORY_LOCK = "dte_settings_conversion_v1"
const SENSITIVE_FIELDS: readonly DteSensitiveSettingField[] = [
  "rutUsr",
  "rutEmp",
  "clave",
  "codEmp",
  "importerEmail",
]
/**
 * Secretos que NO son del portal DTE pero se cifran con el MISMO keyring
 * (`billing.chipax.*`). El re-cifrado tiene que re-envolverlos: si se quedan
 * con el `kid` retirado, el sobre no vuelve a abrirse nunca y Chipax cae en
 * silencio a la credencial del `.env`.
 */
const SHARED_KEYRING_SECRET_KEYS: readonly string[] = [
  CHIPAX_SETTING_KEYS.appId,
  CHIPAX_SETTING_KEYS.secretKey,
]

const REQUIRED_CREDENTIAL_FIELDS: readonly DteSensitiveSettingField[] = [
  "rutUsr",
  "rutEmp",
  "clave",
  "codEmp",
]

export interface DtePortalSettingsInput {
  /** Empty fields preserve their stored secret; removal must be explicit. */
  rutUsr?: string
  rutEmp?: string
  clave?: string
  codEmp?: string
  importerEmail?: string
  syncEnabled?: boolean
  /** Milliseconds between requests, 0–10,000. */
  delayMs?: number
  clearRutUsr?: boolean
  clearRutEmp?: boolean
  clearClave?: boolean
  clearCodEmp?: boolean
  clearImporterEmail?: boolean
  clearDelayMs?: boolean
}

export interface DteSettingsActor {
  userId: string
  userEmail?: string
}

export type DteSettingsFieldSource = "system_settings" | "environment" | "missing"
export type DteSettingsEncryptionStatus =
  | "not_configured"
  | "legacy"
  | "migration_required"
  | "encrypted"
  | "encrypted_only"
  | "configuration_error"

/** Safe to serialize through an RSC or a Server Action. It intentionally has no values. */
export interface DtePortalAdminStatus {
  configured: boolean
  syncEnabled: boolean
  hasStoredSettings: boolean
  /** True only once the one-way marker is persisted in system_settings. */
  cutoverComplete: boolean
  source: "system_settings" | "environment" | "mixed" | "none"
  encryptionMode: DteSettingsEncryptionMode | "configuration_error"
  encryptionStatus: DteSettingsEncryptionStatus
  /** Historical name: also true for already-enveloped compat settings that need the durable cutover. */
  canMigrateLegacy: boolean
  /**
   * False cuando no hay keyring activo: sin él no se puede guardar ninguna
   * credencial, porque guardarla en claro no es una opción.
   */
  canStoreSecrets: boolean
  fields: Record<DteSensitiveSettingField, { configured: boolean; source: DteSettingsFieldSource }>
}

export class DteSettingsConversionError extends Error {
  constructor(readonly code:
    | "DTE_SETTINGS_ACTIVE_RUN"
    | "DTE_SETTINGS_INCOMPLETE_LEGACY"
    | "DTE_SETTINGS_LEGACY_PRESENT"
    | "DTE_SETTINGS_ENCRYPTED_ONLY_REQUIRED"
    | "DTE_SETTINGS_CUTOVER_IN_PROGRESS"
    | "DTE_SETTINGS_KEYRING_REQUIRED",
  ) {
    super(code)
    this.name = "DteSettingsConversionError"
  }
}

/** Safe runtime failure: never turn a DB outage into an env-secret fallback. */
export class DteSettingsReadError extends Error {
  readonly code = "DTE_SETTINGS_READ_FAILED"

  constructor() {
    super("DTE_SETTINGS_READ_FAILED")
    this.name = "DteSettingsReadError"
  }
}

/**
 * Reads plaintext only within the server process. In encrypted_only a legacy
 * sensitive row is rejected rather than falling back to environment values.
 */
export async function readStoredDteSettings(): Promise<Partial<Record<DteSettingField, string>>> {
  const raw = await readRawDteSettings()
  return decodeStoredDteSettings(raw)
}

/**
 * Runtime-only settings read. Unlike the Admin/status helper, this fails
 * closed if PostgreSQL is unavailable so `config.ts` cannot accidentally use
 * legacy environment credentials without knowing whether a cutover happened.
 */
export async function readStoredDteSettingsStrict(): Promise<Partial<Record<DteSettingField, string>>> {
  let raw: Partial<Record<DteSettingField, string>>
  try {
    raw = await readRawDteSettingsStrict()
  } catch {
    throw new DteSettingsReadError()
  }
  return decodeStoredDteSettings(raw)
}

function decodeStoredDteSettings(
  raw: Partial<Record<DteSettingField, string>>,
): Partial<Record<DteSettingField, string>> {
  const keyring = readDteSettingsKeyring()
  const mode = effectiveEncryptionMode(raw, keyring.mode)
  const values: Partial<Record<DteSettingField, string>> = {}

  for (const [field, value] of Object.entries(raw) as [DteSettingField, string | undefined][]) {
    if (value === undefined) continue
    if (!isSensitiveField(field)) {
      values[field] = value
      continue
    }
    if (isEncryptedDteSetting(value)) {
      values[field] = decryptDteSetting(value, DTE_SETTING_KEYS[field], keyring)
      continue
    }
    if (mode === "encrypted_only") {
      // Do not make a plaintext env credential a surprise fallback after the
      // cutover. The caller sees a redacted configuration error instead.
      throw new Error("DTE_SETTINGS_ENVELOPE_INVALID")
    }
    values[field] = value
  }

  return values
}

/** True if at least one DTE key exists, including a legacy base-url key. */
export async function hasStoredDteSettings(): Promise<boolean> {
  return Object.keys(await readRawDteSettings()).length > 0
}

/**
 * Builds the only configuration object allowed to cross to the Admin client
 * component. It reads raw values solely to answer presence/source questions.
 */
export async function readDtePortalAdminStatus(): Promise<DtePortalAdminStatus> {
  let raw: Partial<Record<DteSettingField, string>>
  try {
    // Unlike a generic compatibility helper, the Admin DTO must not claim
    // environment credentials are usable while the durable settings source is
    // unavailable. It is the operator's control plane for a cutover.
    raw = await readRawDteSettingsStrict()
  } catch {
    return dteAdminConfigurationError()
  }
  const hasStoredSettings = Object.keys(raw).length > 0
  const cutoverComplete = raw.encryptionMode === ENCRYPTED_ONLY
  let keyring: ReturnType<typeof readDteSettingsKeyring> | null = null
  let encryptionMode: DtePortalAdminStatus["encryptionMode"] = "configuration_error"

  try {
    keyring = readDteSettingsKeyring()
    encryptionMode = effectiveEncryptionMode(raw, keyring.mode)
  } catch {
    // Do not serialize the configuration error: an operator only needs to know
    // that the keyring must be repaired on the host.
    keyring = null
  }
  if (!keyring) return dteAdminConfigurationError(hasStoredSettings)

  const fields = Object.fromEntries(SENSITIVE_FIELDS.map((field) => {
    const stored = raw[field]
    const envValue = environmentValueFor(field)
    const canUseEnvironment = encryptionMode !== "encrypted_only"
    const configured = stored !== undefined
      ? Boolean(stored)
      : canUseEnvironment && Boolean(envValue)
    const source: DteSettingsFieldSource = stored !== undefined
      ? "system_settings"
      : canUseEnvironment && envValue ? "environment" : "missing"
    return [field, { configured, source }]
  })) as DtePortalAdminStatus["fields"]

  const sources = new Set<DteSettingsFieldSource>()
  for (const field of Object.values(fields)) {
    if (field.source !== "missing") sources.add(field.source)
  }
  const source = sources.size === 0
    ? "none"
    : sources.size === 1
      ? sources.has("system_settings") ? "system_settings" : "environment"
      : "mixed"
  const storedSensitive = SENSITIVE_FIELDS
    .map((field) => raw[field])
    .filter((value): value is string => value !== undefined)
  const legacySensitive = storedSensitive.filter((value) => !isEncryptedDteSetting(value))
  const encryptionStatus = encryptionMode === "configuration_error"
    ? "configuration_error"
    : cutoverComplete
      ? "encrypted_only"
      : storedSensitive.length === 0
        ? "not_configured"
        : legacySensitive.length > 0
          ? keyring?.activeKeyId ? "migration_required" : "legacy"
          : "encrypted"
  const requestedSyncEnabled = raw.syncEnabled !== undefined
    ? raw.syncEnabled === "true"
    : encryptionMode !== "encrypted_only" && process.env.DTE_SYNC_ENABLED?.trim().toLowerCase() === "true"
  const syncEnabled = requestedSyncEnabled && !isDtePortalStartBarrierPaused(raw.syncStartBarrier)

  return {
    // `importerEmail` improves downstream attribution but the portal itself
    // only authenticates with these four credentials. Do not report the whole
    // integration as unconfigured when that optional enrichment is absent.
    configured: REQUIRED_CREDENTIAL_FIELDS.every((field) => fields[field].configured),
    syncEnabled,
    hasStoredSettings,
    source,
    encryptionMode,
    encryptionStatus,
    // The compatible release can already have encrypted values before the
    // one-way marker is activated. Those values are safe to verify/rewrap and
    // cut over too; requiring a remaining plaintext field would strand them.
    canMigrateLegacy: !cutoverComplete && Boolean(keyring?.activeKeyId) &&
      REQUIRED_CREDENTIAL_FIELDS.every((field) => Boolean(raw[field])),
    canStoreSecrets: Boolean(keyring?.activeKeyId),
    cutoverComplete,
    fields,
  }
}

function dteAdminConfigurationError(hasStoredSettings = false): DtePortalAdminStatus {
  return {
    configured: false,
    syncEnabled: false,
    hasStoredSettings,
    cutoverComplete: false,
    source: "none",
    encryptionMode: "configuration_error",
    encryptionStatus: "configuration_error",
    canMigrateLegacy: false,
    canStoreSecrets: false,
    fields: Object.fromEntries(SENSITIVE_FIELDS.map((field) => [
      field,
      { configured: false, source: "missing" as const },
    ])) as DtePortalAdminStatus["fields"],
  }
}

/**
 * Writes just the fields submitted by Admin. When a keyring exists, every new
 * sensitive value is stored encrypted. A blank sensitive field is a no-op;
 * clear flags are the sole deletion mechanism.
 */
export async function saveDtePortalSettings(
  input: DtePortalSettingsInput,
  actor: DteSettingsActor,
): Promise<void> {
  if (input.delayMs !== undefined) {
    if (!Number.isFinite(input.delayMs) || input.delayMs < 0 || input.delayMs > 10_000) {
      throw new Error("DTE_SETTINGS_DELAY_INVALID")
    }
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${DTE_SETTINGS_ADVISORY_LOCK}))`)
    const rows = await tx
      .select({ key: systemSettings.key, value: systemSettings.value })
      .from(systemSettings)
      .where(like(systemSettings.key, DTE_KEY_PREFIX))
      .for("update")
    const before = rawDteSettingsFromRows(rows)
    const keyring = readDteSettingsKeyring()
    const encryptionMode = effectiveEncryptionMode(before, keyring.mode)
    if (encryptionMode === "encrypted_only" && !keyring.activeKeyId) {
      throw new DteSettingsConversionError("DTE_SETTINGS_KEYRING_REQUIRED")
    }

    const now = new Date().toISOString()
    const writes: { key: string; value: string }[] = []
    const deletes: string[] = []
    const after = { ...before }

    const applySensitive = (
      field: DteSensitiveSettingField,
      value: string | undefined,
      clear: boolean | undefined,
    ) => {
      if (value !== undefined && value !== "") {
        const key = DTE_SETTING_KEYS[field]
        // `compat` existe para poder LEER filas legacy, no para escribir
        // secretos nuevos en claro: sin keyring activo se falla cerrado.
        if (!keyring.activeKeyId) {
          throw new DteSettingsConversionError("DTE_SETTINGS_KEYRING_REQUIRED")
        }
        const encrypted = encryptDteSetting(value, key, keyring)
        writes.push({ key, value: encrypted })
        after[field] = encrypted
        return
      }
      if (clear) {
        deletes.push(DTE_SETTING_KEYS[field])
        delete after[field]
      }
    }

    applySensitive("rutUsr", input.rutUsr?.trim(), input.clearRutUsr)
    applySensitive("rutEmp", input.rutEmp?.trim(), input.clearRutEmp)
    // The password intentionally is not trimmed.
    applySensitive("clave", input.clave, input.clearClave)
    applySensitive("codEmp", input.codEmp?.trim(), input.clearCodEmp)
    applySensitive("importerEmail", input.importerEmail?.trim(), input.clearImporterEmail)

    if (input.delayMs !== undefined) {
      const value = String(Math.trunc(input.delayMs))
      writes.push({ key: DTE_SETTING_KEYS.delayMs, value })
      after.delayMs = value
    } else if (input.clearDelayMs) {
      deletes.push(DTE_SETTING_KEYS.delayMs)
      delete after.delayMs
    }
    if (input.syncEnabled !== undefined) {
      // Conversion/keyring re-cipher owns the fence until it has atomically verified
      // all envelopes. A concurrent Admin save may update missing credentials,
      // but it must not reopen portal I/O halfway through that operation.
      if (input.syncEnabled && before.syncStartBarrier === DTE_SYNC_START_BARRIER_CUTOVER) {
        throw new DteSettingsConversionError("DTE_SETTINGS_CUTOVER_IN_PROGRESS")
      }
      const value = input.syncEnabled ? "true" : "false"
      writes.push({ key: DTE_SETTING_KEYS.syncEnabled, value })
      after.syncEnabled = value
      // Only an explicit re-enable after a completed cutover releases the
      // durable pause. Ordinary edits and `syncEnabled=false` leave it alone.
      if (input.syncEnabled && before.syncStartBarrier === DTE_SYNC_START_BARRIER_PAUSED) {
        writes.push({ key: DTE_SETTING_KEYS.syncStartBarrier, value: DTE_SYNC_START_BARRIER_ACTIVE })
        after.syncStartBarrier = DTE_SYNC_START_BARRIER_ACTIVE
      }
    }

    if (writes.length === 0 && deletes.length === 0) return null

    for (const write of writes) {
      await tx.insert(systemSettings).values({ key: write.key, value: write.value, updatedAt: now }).onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: write.value, updatedAt: now },
      })
    }
    for (const key of new Set(deletes)) {
      await tx.delete(systemSettings).where(eq(systemSettings.key, key))
    }
    // La auditoría de un cambio de credencial se confirma con el cambio: fuera
    // de la transacción, un fallo del INSERT deja el secreto nuevo sin rastro.
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "dte_portal_settings",
      entityId: "batch",
      oldState: summarizeSettings(before),
      newState: summarizeSettings(after),
    }, tx)
    return { before, after }
  })

  if (!result) return
}

/**
 * Removes persisted DTE settings. In encrypted_only this intentionally leaves
 * DTE disabled because config.ts will not fall back to plaintext env values.
 */
export async function clearStoredDteSettings(actor: DteSettingsActor): Promise<void> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${DTE_SETTINGS_ADVISORY_LOCK}))`)
    const rows = await tx
      .select({ key: systemSettings.key, value: systemSettings.value })
      .from(systemSettings)
      .where(like(systemSettings.key, DTE_KEY_PREFIX))
      .for("update")
    const before = rawDteSettingsFromRows(rows)
    if (Object.keys(before).length === 0) return null

    const keyring = readDteSettingsKeyring()
    const encryptedOnly = effectiveEncryptionMode(before, keyring.mode) === "encrypted_only"
    if (encryptedOnly) {
      // Preserve the durable barrier. A clear/reset after cutover must not make
      // a stale DTE_PORTAL_* environment variable usable again.
      for (const key of Object.values(DTE_SETTING_KEYS)) {
        if (key === DTE_SETTING_KEYS.encryptionMode || key === DTE_SETTING_KEYS.syncStartBarrier) continue
        await tx.delete(systemSettings).where(eq(systemSettings.key, key))
      }
      const now = new Date().toISOString()
      await tx.insert(systemSettings).values({
        key: DTE_SETTING_KEYS.syncStartBarrier,
        value: DTE_SYNC_START_BARRIER_PAUSED,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: DTE_SYNC_START_BARRIER_PAUSED, updatedAt: now },
      })
    } else {
      await tx.delete(systemSettings).where(like(systemSettings.key, DTE_KEY_PREFIX))
    }
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "delete",
      entityType: "dte_portal_settings",
      entityId: "batch",
      oldState: summarizeSettings(before),
      newState: encryptedOnly ? { encryptedOnly: true } : {},
    }, tx)
    return { before, encryptedOnly }
  })

  if (!result) return
}

/**
 * One-way controlled conversion. It first pauses new portal starts, waits for
 * bounded request leases that prove credential-bearing I/O may still be on the
 * wire, then holds a PostgreSQL transaction advisory lock while it converts
 * every sensitive field and enables the durable encrypted-only barrier. It
 * preserves the exact provider values; no portal credential is changed. Any
 * failure leaves synchronization paused.
 */
export async function convertLegacyDteSettings(actor: DteSettingsActor): Promise<{ converted: number; keyId: string }> {
  if (!readDteSettingsKeyring().activeKeyId) {
    throw new DteSettingsConversionError("DTE_SETTINGS_KEYRING_REQUIRED")
  }

  // Stop new cron/manual starts before waiting. Existing in-flight requests
  // are detected below; a failure intentionally does not silently re-enable.
  await pauseDteSyncStarts()
  await waitForNoActivePortalOperations()

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${DTE_SETTINGS_ADVISORY_LOCK}))`)
    const rows = await tx
      .select({ key: systemSettings.key, value: systemSettings.value })
      .from(systemSettings)
      .where(like(systemSettings.key, DTE_KEY_PREFIX))
      .for("update")
    const before = rawDteSettingsFromRows(rows)
    // Re-read while holding the lock: a host keyring change must not make this
    // transaction encrypt under a stale `kid` selected before the cutover.
    const keyring = readDteSettingsKeyring()
    if (!keyring.activeKeyId) throw new DteSettingsConversionError("DTE_SETTINGS_KEYRING_REQUIRED")
    if (before.encryptionMode === ENCRYPTED_ONLY) {
      return { converted: 0, before, after: before, keyId: keyring.activeKeyId }
    }

    const missingRequired = REQUIRED_CREDENTIAL_FIELDS.filter((field) => !before[field])
    if (missingRequired.length > 0) {
      // Conversion must not promote a half-persisted setup into a state where
      // plaintext env fields silently complement encrypted database fields.
      throw new DteSettingsConversionError("DTE_SETTINGS_INCOMPLETE_LEGACY")
    }

    const legacy = SENSITIVE_FIELDS.filter((field) => {
      const value = before[field]
      return value !== undefined && !isEncryptedDteSetting(value)
    })

    const encrypted: Array<{ key: string; value: string }> = []
    for (const field of SENSITIVE_FIELDS) {
      const value = before[field]
      if (value === undefined) continue
      const plaintext = isEncryptedDteSetting(value)
        ? decryptDteSetting(value, DTE_SETTING_KEYS[field], keyring)
        : value
      const envelope = encryptDteSetting(plaintext, DTE_SETTING_KEYS[field], keyring)
      // Verify the newly written material before committing any setting.
      if (decryptDteSetting(envelope, DTE_SETTING_KEYS[field], keyring) !== plaintext) {
        throw new Error("DTE_SETTINGS_ENCRYPTION_VERIFY_FAILED")
      }
      encrypted.push({ key: DTE_SETTING_KEYS[field], value: envelope })
    }

    const now = new Date().toISOString()
    for (const setting of encrypted) {
      await tx.insert(systemSettings).values({ ...setting, updatedAt: now }).onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: setting.value, updatedAt: now },
      })
    }
    await tx.insert(systemSettings).values({ key: DTE_SETTING_KEYS.syncEnabled, value: "false", updatedAt: now }).onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: "false", updatedAt: now },
    })
    await tx.insert(systemSettings).values({ key: DTE_SETTING_KEYS.syncStartBarrier, value: DTE_SYNC_START_BARRIER_PAUSED, updatedAt: now }).onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: DTE_SYNC_START_BARRIER_PAUSED, updatedAt: now },
    })
    await tx.insert(systemSettings).values({ key: DTE_SETTING_KEYS.encryptionMode, value: ENCRYPTED_ONLY, updatedAt: now }).onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: ENCRYPTED_ONLY, updatedAt: now },
    })
    await tx.delete(systemSettings).where(eq(systemSettings.key, DTE_SETTING_KEYS.baseUrl))

    const after = {
      ...before,
      syncEnabled: "false",
      syncStartBarrier: DTE_SYNC_START_BARRIER_PAUSED,
      encryptionMode: ENCRYPTED_ONLY,
    }
    for (const setting of encrypted) {
      const field = (Object.keys(DTE_SETTING_KEYS) as DteSettingField[]).find((candidate) => DTE_SETTING_KEYS[candidate] === setting.key)
      if (field) after[field] = setting.value
    }
    delete after.baseUrl
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "dte_portal_settings_encryption",
      entityId: "conversion",
      oldState: summarizeSettings(before),
      newState: { ...summarizeSettings(after), encryptedOnly: true, convertedFields: legacy.length },
    }, tx)
    return { converted: legacy.length, before, after, keyId: keyring.activeKeyId }
  })

  return { converted: result.converted, keyId: result.keyId }
}

/**
 * Re-wraps every encrypted setting under the active key ID. It decrypts and
 * re-encrypts the same plaintext; it never changes a FacturaEnLínea credential.
 * The caller keeps both key IDs in the app keyring until this verifies
 * successfully; only then may the retired key leave the host configuration.
 */
export async function rotateDteSettingsKeyring(actor: DteSettingsActor): Promise<{ rewrapped: number; keyId: string }> {
  if (!readDteSettingsKeyring().activeKeyId) {
    throw new DteSettingsConversionError("DTE_SETTINGS_KEYRING_REQUIRED")
  }

  await pauseDteSyncStarts()
  await waitForNoActivePortalOperations()
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${DTE_SETTINGS_ADVISORY_LOCK}))`)
    const rows = await tx
      .select({ key: systemSettings.key, value: systemSettings.value })
      .from(systemSettings)
      .where(or(
        like(systemSettings.key, DTE_KEY_PREFIX),
        inArray(systemSettings.key, [...SHARED_KEYRING_SECRET_KEYS]),
      ))
      .for("update")
    const before = rawDteSettingsFromRows(rows)
    const keyring = readDteSettingsKeyring()
    if (!keyring.activeKeyId) throw new DteSettingsConversionError("DTE_SETTINGS_KEYRING_REQUIRED")
    if (before.encryptionMode !== ENCRYPTED_ONLY) {
      throw new DteSettingsConversionError("DTE_SETTINGS_ENCRYPTED_ONLY_REQUIRED")
    }
    const legacy = SENSITIVE_FIELDS.some((field) => {
      const value = before[field]
      return value !== undefined && !isEncryptedDteSetting(value)
    })
    if (legacy) throw new DteSettingsConversionError("DTE_SETTINGS_LEGACY_PRESENT")

    const now = new Date().toISOString()
    let rewrapped = 0
    const after = { ...before, syncEnabled: "false" }
    for (const field of SENSITIVE_FIELDS) {
      const value = before[field]
      if (value === undefined) continue
      const plaintext = decryptDteSetting(value, DTE_SETTING_KEYS[field], keyring)
      const envelope = encryptDteSetting(plaintext, DTE_SETTING_KEYS[field], keyring)
      if (decryptDteSetting(envelope, DTE_SETTING_KEYS[field], keyring) !== plaintext) {
        throw new Error("DTE_SETTINGS_ROTATION_VERIFY_FAILED")
      }
      await tx.insert(systemSettings).values({ key: DTE_SETTING_KEYS[field], value: envelope, updatedAt: now }).onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: envelope, updatedAt: now },
      })
      after[field] = envelope
      rewrapped += 1
    }
    // Los secretos de Chipax comparten este keyring: si no se re-envuelven acá,
    // retirar la clave anterior (paso final del runbook) los deja ilegibles.
    for (const key of SHARED_KEYRING_SECRET_KEYS) {
      const value = rows.find((row) => row.key === key)?.value
      // Un valor sin sobre sólo puede venir de una escritura a mano y ya se
      // ignora al leerlo; re-cifrarlo lo convertiría en credencial vigente.
      if (value === undefined || !isEncryptedDteSetting(value)) continue
      const plaintext = decryptDteSetting(value, key, keyring)
      const envelope = encryptDteSetting(plaintext, key, keyring)
      if (decryptDteSetting(envelope, key, keyring) !== plaintext) {
        throw new Error("DTE_SETTINGS_ROTATION_VERIFY_FAILED")
      }
      await tx.insert(systemSettings).values({ key, value: envelope, updatedAt: now }).onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: envelope, updatedAt: now },
      })
      rewrapped += 1
    }
    await tx.insert(systemSettings).values({ key: DTE_SETTING_KEYS.syncEnabled, value: "false", updatedAt: now }).onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: "false", updatedAt: now },
    })
    await tx.insert(systemSettings).values({ key: DTE_SETTING_KEYS.syncStartBarrier, value: DTE_SYNC_START_BARRIER_PAUSED, updatedAt: now }).onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: DTE_SYNC_START_BARRIER_PAUSED, updatedAt: now },
    })
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "dte_portal_settings_encryption",
      entityId: "rotation",
      oldState: summarizeSettings(before),
      newState: { ...summarizeSettings(after), rewrappedFields: rewrapped },
    }, tx)
    return { rewrapped, before, after, keyId: keyring.activeKeyId }
  })

  return { rewrapped: result.rewrapped, keyId: result.keyId }
}

async function readRawDteSettings(): Promise<Partial<Record<DteSettingField, string>>> {
  try {
    return await readRawDteSettingsStrict()
  } catch {
    // A DB read failure disables the encrypted-only config downstream rather
    // than leaking into a browser or using an unintended plaintext fallback.
    return {}
  }
}

async function readRawDteSettingsStrict(): Promise<Partial<Record<DteSettingField, string>>> {
  const rows = await db
    .select({ key: systemSettings.key, value: systemSettings.value })
    .from(systemSettings)
    .where(like(systemSettings.key, DTE_KEY_PREFIX))
  return rawDteSettingsFromRows(rows)
}

function rawDteSettingsFromRows(rows: Array<{ key: string; value: string }>): Partial<Record<DteSettingField, string>> {
  const values: Partial<Record<DteSettingField, string>> = {}
  for (const row of rows) {
    const field = (Object.keys(DTE_SETTING_KEYS) as DteSettingField[]).find((candidate) => DTE_SETTING_KEYS[candidate] === row.key)
    if (field) values[field] = row.value
  }
  return values
}

function effectiveEncryptionMode(
  stored: Partial<Record<DteSettingField, string>>,
  configured: DteSettingsEncryptionMode,
): DteSettingsEncryptionMode {
  return stored.encryptionMode === ENCRYPTED_ONLY ? "encrypted_only" : configured
}

/** Missing means legacy-compatible active; any unknown persisted value fails closed. */
export function isDtePortalStartBarrierPaused(value: string | undefined): boolean {
  return value !== undefined && value !== DTE_SYNC_START_BARRIER_ACTIVE
}

/** Only these persisted values represent an operator-owned, temporary pause. */
export function isDtePortalStartBarrierIntentionalPause(value: string | undefined): boolean {
  return value === DTE_SYNC_START_BARRIER_PAUSED || value === DTE_SYNC_START_BARRIER_CUTOVER
}

/** Atomically fence new starts before conversion waits for active work. */
async function pauseDteSyncStarts(): Promise<void> {
  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${DTE_SETTINGS_ADVISORY_LOCK}))`)
    await tx.insert(systemSettings).values({
      key: DTE_SETTING_KEYS.syncEnabled,
      value: "false",
      updatedAt: now,
    }).onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: "false", updatedAt: now },
    })
    await tx.insert(systemSettings).values({
      key: DTE_SETTING_KEYS.syncStartBarrier,
      value: DTE_SYNC_START_BARRIER_CUTOVER,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: DTE_SYNC_START_BARRIER_CUTOVER, updatedAt: now },
    })
  })
}

async function waitForNoActivePortalOperations(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const active = await db
      .select({ id: dtePortalOperationLeases.id })
      .from(dtePortalOperationLeases)
      .where(gte(dtePortalOperationLeases.leaseExpiresAt, new Date().toISOString()))
      .limit(1)
    if (active.length === 0) return
    if (Date.now() >= deadline) throw new DteSettingsConversionError("DTE_SETTINGS_ACTIVE_RUN")
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
  }
}

function isSensitiveField(field: DteSettingField): field is DteSensitiveSettingField {
  return (SENSITIVE_FIELDS as readonly string[]).includes(field)
}

function environmentValueFor(field: DteSensitiveSettingField): string | undefined {
  const byField: Record<DteSensitiveSettingField, string | undefined> = {
    rutUsr: process.env.DTE_PORTAL_RUT_USR?.trim(),
    rutEmp: process.env.DTE_PORTAL_RUT_EMP?.trim(),
    clave: process.env.DTE_PORTAL_CLAVE,
    codEmp: process.env.DTE_PORTAL_CODEMP?.trim(),
    importerEmail: process.env.DTE_SYNC_IMPORTER_EMAIL?.trim(),
  }
  return byField[field]
}

/** Audit data deliberately records only state transitions, never PII/secrets. */
function summarizeSettings(stored: Partial<Record<DteSettingField, string>>): Record<string, boolean> {
  const summary: Record<string, boolean> = {}
  for (const field of SENSITIVE_FIELDS) {
    summary[`${field}Configured`] = Boolean(stored[field])
  }
  summary.syncEnabled = stored.syncEnabled === "true"
  summary.delayConfigured = Boolean(stored.delayMs)
  return summary
}

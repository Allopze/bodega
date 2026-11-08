/**
 * lib/services/encrypted-settings.ts
 *
 * Ajustes de integraciones administrables desde la plataforma, con los secretos
 * cifrados en `system_settings` y el `.env` del servidor como respaldo.
 *
 * ## Por qué existe
 *
 * OnWay, Chipax y Cloudreve resolvieron lo mismo tres veces casi con las mismas
 * líneas: leer las filas, abrir el sobre, caer al entorno, decir de dónde viene
 * cada valor sin revelarlo, exigir llavero para escribir y auditar sin el
 * secreto. Talana, VisionLink, Copec, Resend y la automatización de facturas de
 * venta usan este helper en lugar de sumar una cuarta, quinta… copia. La
 * semántica es la de Chipax, la más limpia y probada de las tres:
 *
 * - **Lo guardado gana; el `.env` es el respaldo.** Mientras nadie guarde nada
 *   desde la pantalla, la configuración vigente es exactamente la de antes.
 * - **BD caída → entorno, con aviso en el log.** Dejar una integración «sin
 *   configurar» por una caída de Postgres apagaría algo que el `.env` sostiene.
 * - **Fila sin cifrar en un campo secreto → se ignora.** Sólo puede venir de una
 *   escritura a mano; aceptarla sería operar con un secreto en claro.
 * - **Sobre que no se puede abrir → vacío, NO el `.env`.** Caer al entorno ahí
 *   es operar con la credencial ANTIGUA, la que la rotación vino a reemplazar,
 *   sin que nadie lo note.
 * - **Sin llavero activo no se escribe ningún secreto**, y tampoco se audita: la
 *   operación entera se rechaza antes de tocar la BD.
 * - **La auditoría dice qué cambió, nunca a qué** en un secreto (`<campo>Updated`
 *   / `<campo>Cleared`). Los valores no secretos (un modo, un interruptor) sí
 *   viajan, con su valor anterior. Un guardado que no cambia nada no audita.
 *
 * El llavero es el de la aplicación (`DTE_SETTINGS_KEYRING`); el prefijo «Dte»
 * de las funciones de cifrado es histórico. El AAD de cada sobre es la key física
 * del setting, así que un ciphertext no se puede trasplantar a otra key.
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
  type DteSettingsKeyring,
} from "@/lib/services/dte-portal/settings-crypto"
import { isRegisteredSecretKey } from "@/lib/services/settings-secret-keys"

/* ── Definición ──────────────────────────────────────────────────────────── */

export type SettingSource = "system_settings" | "environment" | "missing"

export interface SettingFieldSpec {
  /** Key física en `system_settings`. */
  key: string
  /** True si se guarda cifrado y jamás cruza al cliente. */
  secret: boolean
}

export interface SettingsGroup<F extends string> {
  /** Nombre corto para los logs, p. ej. `talana`. */
  readonly name: string
  /** `entityType` / `entityId` de la auditoría. */
  readonly entityType: string
  readonly entityId: string
  readonly fields: Readonly<Record<F, SettingFieldSpec>>
}

/**
 * Declara un grupo de ajustes.
 *
 * Falla al cargar el módulo si un campo secreto no está en
 * `SHARED_KEYRING_SECRET_KEYS`: un secreto que la rotación del llavero no
 * re-envuelve queda ilegible el día que se retira la clave anterior, y es mejor
 * enterarse en la primera prueba que en ese día.
 */
export function defineSettingsGroup<F extends string>(spec: {
  name: string
  entityType: string
  entityId: string
  fields: Record<F, SettingFieldSpec>
}): SettingsGroup<F> {
  for (const field of Object.values<SettingFieldSpec>(spec.fields)) {
    if (field.secret && !isRegisteredSecretKey(field.key)) {
      throw new Error(
        `[encrypted-settings] ${spec.name}: «${field.key}» es secreto y no está en SHARED_KEYRING_SECRET_KEYS`,
      )
    }
  }
  return Object.freeze({ ...spec, fields: Object.freeze({ ...spec.fields }) })
}

function fieldEntries<F extends string>(group: SettingsGroup<F>): [F, SettingFieldSpec][] {
  return Object.entries(group.fields) as [F, SettingFieldSpec][]
}

function groupKeys<F extends string>(group: SettingsGroup<F>): string[] {
  return fieldEntries(group).map(([, spec]) => spec.key)
}

/* ── Lectura ─────────────────────────────────────────────────────────────── */

type Raw<F extends string> = Partial<Record<F, string>>
type ReadClient = Pick<typeof db, "select">

async function readRaw<F extends string>(group: SettingsGroup<F>, client: ReadClient): Promise<Raw<F>> {
  const rows = await client
    .select({ key: systemSettings.key, value: systemSettings.value })
    .from(systemSettings)
    .where(inArray(systemSettings.key, groupKeys(group)))

  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  const raw: Raw<F> = {}
  for (const [field, spec] of fieldEntries(group)) {
    const value = byKey.get(spec.key)
    if (value !== undefined) raw[field] = value
  }
  return raw
}

const UNREADABLE = Symbol("encrypted-setting-unreadable")
type Stored = string | null | typeof UNREADABLE

function openStored<F extends string>(group: SettingsGroup<F>, field: F, value: string | undefined): Stored {
  if (value === undefined || value === "") return null
  const spec = group.fields[field]
  if (!spec.secret) return value
  if (!isEncryptedDteSetting(value)) {
    logger.warn(`[settings/${group.name}] valor persistido sin cifrar, ignorado`, { settingKey: spec.key })
    return null
  }
  try {
    return decryptDteSetting(value, spec.key)
  } catch (error) {
    logger.warn(`[settings/${group.name}] no se pudo descifrar un valor persistido`, {
      settingKey: spec.key,
      code: error instanceof Error ? error.message : "UNKNOWN",
    })
    return UNREADABLE
  }
}

/** Valores del `.env` ya normalizados por el lector de cada integración. */
export type SettingsEnvValues<F extends string> = Partial<Record<F, string | undefined>>

export interface ResolvedSettings<F extends string> {
  /** Valor vigente de cada campo; `""` si no hay ninguno. */
  values: Record<F, string>
  sources: Record<F, SettingSource>
  /** Campos con un sobre guardado que este servidor no puede abrir. */
  unreadable: F[]
}

function resolve<F extends string>(
  group: SettingsGroup<F>,
  raw: Raw<F>,
  env: SettingsEnvValues<F>,
): ResolvedSettings<F> {
  const values = {} as Record<F, string>
  const sources = {} as Record<F, SettingSource>
  const unreadable: F[] = []
  for (const [field] of fieldEntries(group)) {
    const stored = openStored(group, field, raw[field])
    if (stored === UNREADABLE) {
      values[field] = ""
      sources[field] = "missing"
      unreadable.push(field)
      continue
    }
    if (stored !== null) {
      values[field] = stored
      sources[field] = "system_settings"
      continue
    }
    const fromEnv = env[field] ?? ""
    values[field] = fromEnv
    sources[field] = fromEnv ? "environment" : "missing"
  }
  return { values, sources, unreadable }
}

/**
 * Configuración vigente del grupo: lo guardado, con el entorno de respaldo.
 * Si la BD no responde se usa el entorno y se deja constancia en el log.
 */
export async function readSettingsGroup<F extends string>(
  group: SettingsGroup<F>,
  env: SettingsEnvValues<F>,
  client: ReadClient = db,
): Promise<ResolvedSettings<F>> {
  let raw: Raw<F>
  try {
    raw = await readRaw(group, client)
  } catch (error) {
    logger.warn(`[settings/${group.name}] no se pudieron leer los ajustes persistidos`, {
      message: error instanceof Error ? error.message : String(error),
    })
    raw = {}
  }
  return resolve(group, raw, env)
}

export interface SettingFieldStatus {
  configured: boolean
  source: SettingSource
  /** Sólo en campos no secretos: un secreto nunca cruza al cliente. */
  value?: string
}

/** DTO seguro para la pantalla: dice si hay valor y de dónde, nunca un secreto. */
export interface SettingsAdminStatus<F extends string> {
  fields: Record<F, SettingFieldStatus>
  /** True si hay al menos una fila persistida (habilita «Restaurar»). */
  hasStoredSettings: boolean
  /** False sin llavero activo: sin él no se puede guardar ningún secreto. */
  canStoreSecrets: boolean
}

export async function readSettingsAdminStatus<F extends string>(
  group: SettingsGroup<F>,
  env: SettingsEnvValues<F>,
  client: ReadClient = db,
): Promise<SettingsAdminStatus<F>> {
  let raw: Raw<F>
  try {
    raw = await readRaw(group, client)
  } catch (error) {
    logger.warn(`[settings/${group.name}] no se pudieron leer los ajustes persistidos`, {
      message: error instanceof Error ? error.message : String(error),
    })
    raw = {}
  }
  const resolved = resolve(group, raw, env)
  const fields = {} as Record<F, SettingFieldStatus>
  for (const [field, spec] of fieldEntries(group)) {
    const value = resolved.values[field]
    fields[field] = {
      configured: value !== "",
      source: resolved.sources[field],
      ...(spec.secret || value === "" ? {} : { value }),
    }
  }
  return {
    fields,
    hasStoredSettings: Object.keys(raw).length > 0,
    canStoreSecrets: canStoreSettingsSecrets(),
  }
}

/** True si el servidor tiene un llavero con clave activa para cifrar. */
export function canStoreSettingsSecrets(): boolean {
  try {
    return Boolean(readDteSettingsKeyring().activeKeyId)
  } catch {
    // Llavero mal formado: la persona necesita saber que no puede guardar, no
    // el detalle del error de configuración del host.
    return false
  }
}

/* ── Escritura ───────────────────────────────────────────────────────────── */

export type EncryptedSettingsErrorCode = "SETTINGS_KEYRING_REQUIRED" | "SETTINGS_FIELD_CONFLICT"

export class EncryptedSettingsError extends Error {
  constructor(readonly code: EncryptedSettingsErrorCode) {
    // El código es seguro para logs y respuestas: nunca lleva un valor.
    super(code)
    this.name = "EncryptedSettingsError"
  }
}

export interface SettingsActor {
  userId: string
  userEmail?: string
}

export interface SettingsChangeInput<F extends string> {
  /** Valores a escribir. Vacío o ausente conserva el actual. */
  set?: Partial<Record<F, string | undefined>>
  /** Campos a borrar: vuelven al `.env` del servidor. */
  clear?: readonly F[]
}

export interface SettingsChangeResult<F extends string> {
  changed: boolean
  updated: F[]
  cleared: F[]
}

type WriteClient = Pick<typeof db, "transaction">

function requireKeyring(): DteSettingsKeyring {
  let keyring: DteSettingsKeyring
  try {
    keyring = readDteSettingsKeyring()
  } catch {
    throw new EncryptedSettingsError("SETTINGS_KEYRING_REQUIRED")
  }
  if (!keyring.activeKeyId) throw new EncryptedSettingsError("SETTINGS_KEYRING_REQUIRED")
  return keyring
}

/** True si el sobre guardado ya contiene exactamente `plaintext`. */
function storedSecretEquals(stored: string | undefined, key: string, plaintext: string, keyring: DteSettingsKeyring): boolean {
  if (!stored || !isEncryptedDteSetting(stored)) return false
  try {
    return decryptDteSetting(stored, key, keyring) === plaintext
  } catch {
    return false
  }
}

/**
 * Aplica lo que el formulario mandó, en una transacción con su auditoría.
 *
 * Un valor vacío conserva el actual: abrir el formulario y guardar no borra
 * credenciales sin querer. Borrar es explícito (`clear`). Escribir y borrar el
 * mismo campo a la vez se rechaza. Sin llavero activo, un secreto no se escribe
 * y la operación entera se rechaza antes de tocar la BD.
 */
export async function saveSettingsGroup<F extends string>(
  group: SettingsGroup<F>,
  // `NoInfer`: los campos salen del grupo, no del literal. Sin él, un
  // `clear: ["token"]` estrechaba `F` a "token" y TypeScript rechazaba el resto
  // de los campos en `set`.
  input: SettingsChangeInput<NoInfer<F>>,
  actor: SettingsActor,
  client: WriteClient = db,
): Promise<SettingsChangeResult<F>> {
  const sets = (Object.entries(input.set ?? {}) as [F, string | undefined][])
    .filter((entry): entry is [F, string] => typeof entry[1] === "string" && entry[1] !== "")
    .filter(([field]) => field in group.fields)
  const clears = [...new Set(input.clear ?? [])].filter((field) => field in group.fields)

  if (sets.some(([field]) => clears.includes(field))) {
    throw new EncryptedSettingsError("SETTINGS_FIELD_CONFLICT")
  }

  const needsKeyring = sets.some(([field]) => group.fields[field].secret)
  const keyring = needsKeyring ? requireKeyring() : null

  return client.transaction(async (tx) => {
    const current = await readRaw(group, tx)

    const writes: { field: F; key: string; value: string }[] = []
    for (const [field, value] of sets) {
      const spec = group.fields[field]
      if (spec.secret) {
        // Re-guardar el mismo secreto no es un cambio: no se re-cifra ni audita.
        if (storedSecretEquals(current[field], spec.key, value, keyring!)) continue
        writes.push({ field, key: spec.key, value: encryptDteSetting(value, spec.key, keyring!) })
      } else {
        if (current[field] === value) continue
        writes.push({ field, key: spec.key, value })
      }
    }
    const deletes = clears.filter((field) => current[field] !== undefined)

    if (writes.length === 0 && deletes.length === 0) {
      return { changed: false, updated: [], cleared: [] }
    }

    const updatedAt = new Date().toISOString()
    for (const write of writes) {
      await tx
        .insert(systemSettings)
        .values({ key: write.key, value: write.value, updatedAt })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: write.value, updatedAt } })
    }
    if (deletes.length > 0) {
      await tx
        .delete(systemSettings)
        .where(inArray(systemSettings.key, deletes.map((field) => group.fields[field].key)))
    }

    // Qué cambió, nunca a qué en un secreto. Los valores no secretos sí viajan,
    // con el anterior, porque responden «¿quién pasó la sync a aplicar?».
    const oldState: Record<string, unknown> = {}
    const newState: Record<string, unknown> = {}
    for (const write of writes) {
      if (group.fields[write.field].secret) {
        newState[`${write.field}Updated`] = true
      } else {
        oldState[write.field] = current[write.field] ?? null
        newState[write.field] = write.value
      }
    }
    for (const field of deletes) {
      if (group.fields[field].secret) {
        newState[`${field}Cleared`] = true
      } else {
        oldState[field] = current[field] ?? null
        newState[field] = null
      }
    }

    // La auditoría se confirma con el cambio: fuera de la transacción, un fallo
    // del commit dejaría el secreto nuevo sin rastro de quién lo tocó.
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: group.entityType,
      entityId: group.entityId,
      oldState: Object.keys(oldState).length > 0 ? oldState : undefined,
      newState,
    }, tx)

    return { changed: true, updated: writes.map((write) => write.field), cleared: deletes }
  })
}

/** Borra todo lo persistido del grupo y devuelve el mando al `.env`. */
export async function clearSettingsGroup<F extends string>(
  group: SettingsGroup<F>,
  actor: SettingsActor,
  client: WriteClient = db,
): Promise<{ changed: boolean }> {
  return client.transaction(async (tx) => {
    const current = await readRaw(group, tx)
    const stored = Object.keys(current) as F[]
    if (stored.length === 0) return { changed: false }

    await tx.delete(systemSettings).where(inArray(systemSettings.key, groupKeys(group)))
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "delete",
      entityType: group.entityType,
      entityId: group.entityId,
      newState: { cleared: stored },
    }, tx)
    return { changed: true }
  })
}

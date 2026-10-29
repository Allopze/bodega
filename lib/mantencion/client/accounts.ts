import { STORE, idbDelete, idbGet, idbGetAll, idbPut } from "./db"
import { requestCredential, type ApiFailure } from "./api"
import { emit } from "./events"
import { getDeviceId, getMeta, setMeta } from "./meta"
import { hashPin, isValidPin, verifyPinHash } from "./pin"
import type { DeviceAccount } from "./types"

/** Menos de esto de vida y, con sesión de la plataforma a mano, se renueva la credencial. */
export const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000
/** Tras 5 PIN errados seguidos se espera; cada fallo más duplica la espera hasta 5 minutos. */
export const PIN_FREE_ATTEMPTS = 5
export const PIN_BASE_LOCK_MS = 30_000
export const PIN_MAX_LOCK_MS = 5 * 60_000

export async function listAccounts(): Promise<DeviceAccount[]> {
  const accounts = await idbGetAll<DeviceAccount>(STORE.accounts)
  return accounts.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
}

export async function getAccount(userId: string): Promise<DeviceAccount | null> {
  return (await idbGet<DeviceAccount>(STORE.accounts, userId)) ?? null
}

export async function saveAccount(account: DeviceAccount): Promise<void> {
  await idbPut(STORE.accounts, account)
  emit("accounts")
}

export async function removeAccount(userId: string): Promise<void> {
  await idbDelete(STORE.accounts, userId)
  emit("accounts")
}

export function credentialExpired(account: Pick<DeviceAccount, "expiresAt">, now = Date.now()): boolean {
  return Date.parse(account.expiresAt) <= now
}

/** ¿Se puede enviar con esta cuenta? Vencida o marcada `needs_login` = hay que entrar de nuevo. */
export function canSync(account: DeviceAccount, now = Date.now()): boolean {
  return account.status === "ok" && !credentialExpired(account, now)
}

export function deviceLabel(userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const system = /iPad/.test(userAgent) ? "iPad" : /iPhone/.test(userAgent) ? "iPhone" : /Android/.test(userAgent) ? "Android" : /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) ? "Mac" : "Dispositivo"
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "navegador"
  return `${system} · ${browser}`
}

export type RegisterResult =
  | { ok: true; account: DeviceAccount }
  | { ok: false; failure: ApiFailure }

/**
 * Con sesión de la plataforma, pide la credencial de este equipo y deja la
 * cuenta guardada. Conserva el PIN y el último uso si la cuenta ya existía:
 * renovar la credencial no puede obligar a definir el PIN otra vez.
 */
export async function registerDeviceAccount(fetchImpl?: typeof fetch): Promise<RegisterResult> {
  const deviceId = await getDeviceId()
  const result = await requestCredential(deviceId, deviceLabel(), fetchImpl)
  if (result.kind !== "ok") return { ok: false, failure: result }
  const { token, expiresAt, user } = result.value
  const previous = await getAccount(user.id)
  const account: DeviceAccount = {
    userId: user.id,
    name: user.name,
    email: user.email,
    token,
    expiresAt,
    pin: previous?.pin ?? null,
    pinFailures: previous?.pinFailures ?? 0,
    pinLockedUntil: previous?.pinLockedUntil ?? null,
    status: "ok",
    lastUsedAt: previous?.lastUsedAt ?? new Date().toISOString(),
  }
  await saveAccount(account)
  return { ok: true, account }
}

export async function markAccountNeedsLogin(userId: string): Promise<void> {
  const account = await getAccount(userId)
  if (!account || account.status === "needs_login") return
  await saveAccount({ ...account, status: "needs_login" })
}

export async function getActiveAccountId(): Promise<string | null> {
  return (await getMeta("activeAccountId")) ?? null
}

export async function setActiveAccount(userId: string | null): Promise<void> {
  await setMeta("activeAccountId", userId)
  if (userId) {
    const account = await getAccount(userId)
    if (account) await saveAccount({ ...account, lastUsedAt: new Date().toISOString() })
  } else {
    emit("accounts")
  }
}

export async function setPin(userId: string, pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error("El PIN son 4 dígitos.")
  const account = await getAccount(userId)
  if (!account) throw new Error("No encontramos la cuenta en este teléfono.")
  await saveAccount({ ...account, pin: await hashPin(pin), pinFailures: 0, pinLockedUntil: null })
}

export async function clearPin(userId: string): Promise<void> {
  const account = await getAccount(userId)
  if (!account) return
  await saveAccount({ ...account, pin: null, pinFailures: 0, pinLockedUntil: null })
}

export type PinCheck =
  | { ok: true }
  | { ok: false; locked: false; attemptsLeft: number }
  | { ok: false; locked: true; until: number }

export function pinLockMs(failures: number): number {
  if (failures < PIN_FREE_ATTEMPTS) return 0
  return Math.min(PIN_BASE_LOCK_MS * 2 ** (failures - PIN_FREE_ATTEMPTS), PIN_MAX_LOCK_MS)
}

/** Verifica el PIN de una cuenta (con o sin señal) y lleva la cuenta de fallos. */
export async function checkPin(userId: string, pin: string, now = Date.now()): Promise<PinCheck> {
  const account = await getAccount(userId)
  if (!account?.pin) return { ok: false, locked: false, attemptsLeft: 0 }
  if (account.pinLockedUntil && account.pinLockedUntil > now) return { ok: false, locked: true, until: account.pinLockedUntil }
  if (await verifyPinHash(pin, account.pin)) {
    if (account.pinFailures || account.pinLockedUntil) await saveAccount({ ...account, pinFailures: 0, pinLockedUntil: null })
    return { ok: true }
  }
  const failures = account.pinFailures + 1
  const lock = pinLockMs(failures)
  await saveAccount({ ...account, pinFailures: failures, pinLockedUntil: lock ? now + lock : null })
  return lock
    ? { ok: false, locked: true, until: now + lock }
    : { ok: false, locked: false, attemptsLeft: PIN_FREE_ATTEMPTS - failures }
}

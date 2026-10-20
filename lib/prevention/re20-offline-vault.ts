"use client"

export type OfflineDraftKind = "incident_report" | "incident_report_config" | "incident_workspace"

export interface OfflineDraft<T = unknown> {
  id: string
  kind: OfflineDraftKind
  payload: T
  createdAt: string
  updatedAt: string
  attempts: number
  lastError?: string
}

interface VaultMetadata {
  id: string
  userId: string
  deviceId: string
  salt: string
  verifierIv: string
  verifierCiphertext: string
  createdAt: string
}

interface DraftEnvelope {
  id: string
  userId: string
  draftId: string
  kind: OfflineDraftKind
  createdAt: string
  updatedAt: string
  attempts: number
  lastError?: string
  iv: string
  ciphertext: string
}

const DB_NAME = "chome-re20-encrypted-vault"
const DB_VERSION = 1
const META_STORE = "vault-metadata"
const DRAFT_STORE = "encrypted-drafts"
const ITERATIONS = 310_000
const IDLE_LOCK_MS = 15 * 60_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const keys = new Map<string, CryptoKey>()
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
let lockChannel: BroadcastChannel | null = null

function emitVaultLocked(userId: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("re20-vault-locked", { detail: { userId } }))
}

function getLockChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null
  if (lockChannel) return lockChannel
  lockChannel = new BroadcastChannel("chome-re20-vault-lock")
  lockChannel.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (!event.data || typeof event.data !== "object" || !("userId" in event.data) || typeof event.data.userId !== "string") return
    lockRe20Vault(event.data.userId, false)
  })
  return lockChannel
}

function openVault(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Este navegador no ofrece almacenamiento cifrado local."))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "id" })
      if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir la bóveda local."))
  })
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Falló el almacenamiento local cifrado."))
  })
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ""
  const sliceSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += sliceSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + sliceSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function randomId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"])
  return crypto.subtle.deriveKey(
    // Encode the random salt as ASCII so it is accepted consistently by
    // WebCrypto across browser and jsdom realms.
    { name: "PBKDF2", salt: encoder.encode(bytesToBase64(salt)), iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

async function encrypt(key: CryptoKey, value: unknown, aad: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(aad) }, key, encoder.encode(JSON.stringify(value)))
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }
}

async function decrypt<T>(key: CryptoKey, iv: string, ciphertext: string, aad: string): Promise<T> {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv), additionalData: encoder.encode(aad) }, key, base64ToBytes(ciphertext))
  return JSON.parse(decoder.decode(plaintext)) as T
}

function touch(userId: string) {
  const timer = idleTimers.get(userId)
  if (timer) clearTimeout(timer)
  idleTimers.set(userId, setTimeout(() => lockRe20Vault(userId), IDLE_LOCK_MS))
}

function draftKey(userId: string, draftId: string) {
  return `${userId}:${draftId}`
}

function requireUnlocked(userId: string) {
  const key = keys.get(userId)
  if (!key) throw new Error("Desbloquea la bóveda local para abrir o guardar borradores RE-20.")
  touch(userId)
  return key
}

export async function getRe20VaultState(userId: string) {
  const db = await openVault()
  try {
    const metadata = await requestResult(db.transaction(META_STORE).objectStore(META_STORE).get(`vault:${userId}`)) as VaultMetadata | undefined
    const drafts = await requestResult(db.transaction(DRAFT_STORE).objectStore(DRAFT_STORE).getAll()) as DraftEnvelope[]
    return {
      configured: Boolean(metadata),
      unlocked: keys.has(userId),
      draftCount: drafts.filter((draft) => draft.userId === userId).length,
    }
  } finally {
    db.close()
  }
}

export async function unlockRe20Vault(userId: string, passphrase: string) {
  if (passphrase.trim().length < 12) throw new Error("Usa una frase local de al menos 12 caracteres.")
  const db = await openVault()
  try {
    const store = db.transaction(META_STORE, "readonly").objectStore(META_STORE)
    const existing = await requestResult(store.get(`vault:${userId}`)) as VaultMetadata | undefined
    if (existing) {
      const key = await deriveKey(passphrase, base64ToBytes(existing.salt))
      try {
        const verified = await decrypt<string>(key, existing.verifierIv, existing.verifierCiphertext, `re20-vault-verifier:${userId}:${existing.deviceId}`)
        if (verified !== "chome-re20-vault-unlock-v1") throw new Error("Frase local incorrecta.")
      } catch {
        throw new Error("No se pudo desbloquear la bóveda. Verifica la frase local.")
      }
      keys.set(userId, key)
      getLockChannel()
      touch(userId)
      return { configured: true, deviceId: existing.deviceId }
    }

    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await deriveKey(passphrase, salt)
    const deviceId = randomId("device")
    const verifier = await encrypt(key, "chome-re20-vault-unlock-v1", `re20-vault-verifier:${userId}:${deviceId}`)
    const metadata: VaultMetadata = {
      id: `vault:${userId}`,
      userId,
      deviceId,
      salt: bytesToBase64(salt),
      verifierIv: verifier.iv,
      verifierCiphertext: verifier.ciphertext,
      createdAt: new Date().toISOString(),
    }
    const writeDb = await openVault()
    try {
      await requestResult(writeDb.transaction(META_STORE, "readwrite").objectStore(META_STORE).add(metadata))
    } catch (error) {
      throw new Error("No se pudo inicializar la bóveda local; vuelve a intentarlo.", { cause: error })
    } finally {
      writeDb.close()
    }
    keys.set(userId, key)
    getLockChannel()
    touch(userId)
    return { configured: false, deviceId }
  } finally {
    db.close()
  }
}

export function lockRe20Vault(userId?: string, broadcast = true) {
  if (!userId) {
    for (const currentUserId of keys.keys()) lockRe20Vault(currentUserId, broadcast)
    return
  }
  lockRe20VaultForUser(userId, broadcast)
}

function lockRe20VaultForUser(userId: string, broadcast: boolean) {
  const wasUnlocked = keys.has(userId)
  if (userId) {
    keys.delete(userId)
    const timer = idleTimers.get(userId)
    if (timer) clearTimeout(timer)
    idleTimers.delete(userId)
  }
  if (!wasUnlocked) return
  emitVaultLocked(userId)
  if (broadcast) getLockChannel()?.postMessage({ userId })
}

/** Reset the idle timer when the user interacts with an unlocked local workspace. */
export function touchRe20Vault(userId: string) {
  if (keys.has(userId)) touch(userId)
}

export async function putRe20OfflineDraft<T>(userId: string, draft: Omit<OfflineDraft<T>, "createdAt" | "updatedAt"> & Partial<Pick<OfflineDraft<T>, "createdAt" | "updatedAt">>) {
  const key = requireUnlocked(userId)
  const db = await openVault()
  try {
    const store = db.transaction(DRAFT_STORE, "readonly").objectStore(DRAFT_STORE)
    const id = draftKey(userId, draft.id)
    const existing = await requestResult(store.get(id)) as DraftEnvelope | undefined
    const createdAt = draft.createdAt ?? existing?.createdAt ?? new Date().toISOString()
    const updatedAt = draft.updatedAt ?? new Date().toISOString()
    const aad = `re20-vault-draft:${userId}:${draft.id}`
    const encrypted = await encrypt(key, draft.payload, aad)
    const envelope: DraftEnvelope = {
      id,
      userId,
      draftId: draft.id,
      kind: draft.kind,
      createdAt,
      updatedAt,
      attempts: draft.attempts,
      ...(draft.lastError ? { lastError: draft.lastError } : {}),
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
    }
    await requestResult(db.transaction(DRAFT_STORE, "readwrite").objectStore(DRAFT_STORE).put(envelope))
    return { createdAt, updatedAt }
  } finally {
    db.close()
  }
}

export async function listRe20OfflineDrafts<T = unknown>(userId: string): Promise<Array<OfflineDraft<T>>> {
  const key = requireUnlocked(userId)
  const db = await openVault()
  try {
    const envelopes = await requestResult(db.transaction(DRAFT_STORE).objectStore(DRAFT_STORE).getAll()) as DraftEnvelope[]
    const owned = envelopes.filter((draft) => draft.userId === userId)
    const result: Array<OfflineDraft<T>> = []
    for (const envelope of owned) {
      result.push({
        id: envelope.draftId,
        kind: envelope.kind,
        payload: await decrypt<T>(key, envelope.iv, envelope.ciphertext, `re20-vault-draft:${userId}:${envelope.draftId}`),
        createdAt: envelope.createdAt,
        updatedAt: envelope.updatedAt,
        attempts: envelope.attempts,
        ...(envelope.lastError ? { lastError: envelope.lastError } : {}),
      })
    }
    return result
  } finally {
    db.close()
  }
}

export async function getRe20OfflineDraft<T = unknown>(userId: string, id: string): Promise<OfflineDraft<T> | null> {
  const key = requireUnlocked(userId)
  const db = await openVault()
  try {
    const envelope = await requestResult(db.transaction(DRAFT_STORE).objectStore(DRAFT_STORE).get(draftKey(userId, id))) as DraftEnvelope | undefined
    if (!envelope) return null
    return {
      id: envelope.draftId,
      kind: envelope.kind,
      payload: await decrypt<T>(key, envelope.iv, envelope.ciphertext, `re20-vault-draft:${userId}:${id}`),
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt,
      attempts: envelope.attempts,
      ...(envelope.lastError ? { lastError: envelope.lastError } : {}),
    }
  } finally {
    db.close()
  }
}

export async function deleteRe20OfflineDraft(userId: string, id: string) {
  requireUnlocked(userId)
  const db = await openVault()
  try {
    await requestResult(db.transaction(DRAFT_STORE, "readwrite").objectStore(DRAFT_STORE).delete(draftKey(userId, id)))
  } finally {
    db.close()
  }
}

export async function listRe20OfflineDraftHeaders(userId: string) {
  const db = await openVault()
  try {
    const envelopes = await requestResult(db.transaction(DRAFT_STORE).objectStore(DRAFT_STORE).getAll()) as DraftEnvelope[]
    return envelopes.filter((draft) => draft.userId === userId).map(({ draftId, kind, createdAt, updatedAt, attempts, lastError }) => ({
      id: draftId, kind, createdAt, updatedAt, attempts, lastError,
    }))
  } finally {
    db.close()
  }
}

/** Perfiles locales sin nombres ni contenido de casos, para desbloquear la bóveda sin red. */
export async function listRe20VaultProfiles() {
  const db = await openVault()
  try {
    const metadata = await requestResult(db.transaction(META_STORE).objectStore(META_STORE).getAll()) as VaultMetadata[]
    return metadata.map(({ userId, deviceId, createdAt }) => ({ userId, deviceId, createdAt }))
  } finally {
    db.close()
  }
}

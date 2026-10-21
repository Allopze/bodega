"use client"

/**
 * Borradores del trabajo sin conexión de Incidentes / RE-20 (reportes por enviar
 * y copia local del expediente), por usuario, en IndexedDB.
 *
 * Es el mismo contrato que la cola de inspecciones: sin frase, sin cifrado
 * propio y sin pantallas de apertura. Cada entrada lleva su `ownerUserId` y
 * nadie lee ni escribe las de otra persona; al cerrar sesión
 * `purgeRe20OfflineDrafts()` vacía todo el almacén (un equipo de faena se
 * comparte, y nada de lo pendiente debe sobrevivir al cambio de usuario).
 *
 * Lo que sí hay que saber: los datos quedan en claro en el disco del equipo
 * hasta que se envían o se cierra sesión.
 */

export type OfflineDraftKind = "incident_report" | "incident_report_config" | "incident_workspace"

export interface OfflineDraft<T = unknown> {
  id: string
  kind: OfflineDraftKind
  payload: T
  createdAt: string
  updatedAt: string
  attempts: number
  lastError?: string
  /** El servidor rechazó el envío de forma permanente: no se reenvía solo, la persona decide (corregir o descartar). */
  rejected?: boolean
}

interface StoredDraft<T = unknown> extends OfflineDraft<T> {
  /** `${ownerUserId}:${id}`: el mismo `id` puede existir para dos personas del mismo equipo. */
  key: string
  ownerUserId: string
}

const DB_NAME = "chome-re20-offline-drafts"
const DB_VERSION = 1
const STORE = "drafts"
const OWNER_INDEX = "ownerUserId"
/** Base de la bóveda cifrada con frase, retirada antes de publicarse: si existe, se borra. */
const RETIRED_VAULT_DB = "chome-re20-encrypted-vault"

let retiredVaultRemoved = false

/** Borra la base de la bóveda retirada. Una vez por carga de página y sin esperar: no hay nada que leer de ella. */
function removeRetiredVault() {
  if (retiredVaultRemoved) return
  retiredVaultRemoved = true
  try {
    const request = indexedDB.deleteDatabase(RETIRED_VAULT_DB)
    request.onerror = () => {}
    request.onblocked = () => {}
  } catch {
    /* no-op: limpiar una base que nadie usa nunca bloquea el trabajo */
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Este navegador no permite guardar trabajo sin conexión en este equipo."))
  removeRetiredVault()
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: "key" })
        store.createIndex(OWNER_INDEX, OWNER_INDEX)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir el almacenamiento de este equipo."))
  })
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Falló el almacenamiento de este equipo."))
  })
}

/** La transacción cierra (commit) cuando termina; con esto se espera al commit y no sólo al último request. */
function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("Falló el almacenamiento de este equipo."))
    transaction.onabort = () => reject(transaction.error ?? new Error("Se canceló el guardado en este equipo."))
  })
}

function draftKey(userId: string, draftId: string) {
  return `${userId}:${draftId}`
}

function publicDraft<T>(stored: StoredDraft<T>): OfflineDraft<T> {
  return {
    id: stored.id,
    kind: stored.kind,
    payload: stored.payload,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    attempts: stored.attempts,
    ...(stored.lastError ? { lastError: stored.lastError } : {}),
    ...(stored.rejected ? { rejected: true } : {}),
  }
}

export async function putRe20OfflineDraft<T>(
  userId: string,
  draft: Omit<OfflineDraft<T>, "createdAt" | "updatedAt"> & Partial<Pick<OfflineDraft<T>, "createdAt" | "updatedAt">>,
) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE, "readwrite")
    const store = transaction.objectStore(STORE)
    const key = draftKey(userId, draft.id)
    const existing = await requestResult(store.get(key)) as StoredDraft | undefined
    const createdAt = draft.createdAt ?? existing?.createdAt ?? new Date().toISOString()
    const updatedAt = draft.updatedAt ?? new Date().toISOString()
    const stored: StoredDraft<T> = {
      key,
      ownerUserId: userId,
      id: draft.id,
      kind: draft.kind,
      payload: draft.payload,
      createdAt,
      updatedAt,
      attempts: draft.attempts,
      ...(draft.lastError ? { lastError: draft.lastError } : {}),
      ...(draft.rejected ? { rejected: true } : {}),
    }
    store.put(stored)
    await transactionDone(transaction)
    return { createdAt, updatedAt }
  } finally {
    database.close()
  }
}

export async function getRe20OfflineDraft<T = unknown>(userId: string, id: string): Promise<OfflineDraft<T> | null> {
  const database = await openDatabase()
  try {
    const stored = await requestResult(database.transaction(STORE).objectStore(STORE).get(draftKey(userId, id))) as StoredDraft<T> | undefined
    return stored && stored.ownerUserId === userId ? publicDraft(stored) : null
  } finally {
    database.close()
  }
}

/** Los borradores de esta persona, del más antiguo al más nuevo. */
export async function listRe20OfflineDrafts<T = unknown>(userId: string): Promise<Array<OfflineDraft<T>>> {
  const database = await openDatabase()
  try {
    const stored = await requestResult(database.transaction(STORE).objectStore(STORE).index(OWNER_INDEX).getAll(userId)) as Array<StoredDraft<T>>
    return stored
      .filter((entry) => entry.ownerUserId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(publicDraft)
  } finally {
    database.close()
  }
}

export async function deleteRe20OfflineDraft(userId: string, id: string) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE, "readwrite")
    transaction.objectStore(STORE).delete(draftKey(userId, id))
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

/**
 * De quién es lo último que se guardó en este equipo, o `null` si no hay nada.
 * La pantalla pública sin conexión no tiene sesión: muestra el trabajo de esta
 * persona (al cerrar sesión el almacén se vacía, así que es casi siempre la única).
 */
export async function lastRe20OfflineDraftOwner(): Promise<string | null> {
  const database = await openDatabase()
  try {
    const all = await requestResult(database.transaction(STORE).objectStore(STORE).getAll()) as StoredDraft[]
    let latest: StoredDraft | null = null
    for (const entry of all) {
      if (!latest || entry.updatedAt > latest.updatedAt) latest = entry
    }
    return latest?.ownerUserId ?? null
  } finally {
    database.close()
  }
}

/** Vacía TODOS los borradores de este equipo, de cualquier persona (cierre de sesión). Devuelve cuántos había. */
export async function purgeRe20OfflineDrafts(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE, "readwrite")
    const store = transaction.objectStore(STORE)
    const count = await requestResult(store.count())
    store.clear()
    await transactionDone(transaction)
    return count
  } finally {
    database.close()
  }
}

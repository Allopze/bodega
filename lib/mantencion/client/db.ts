/**
 * IndexedDB de la app del mecánico. Todo lo que no puede perderse vive aquí:
 * cuentas del dispositivo, catálogos, borradores, la cola de envío y las fotos
 * como Blob. Nunca `localStorage`: no aguanta fotos y se vacía sin avisar.
 *
 * Regla de oro: una escritura que falla por falta de espacio NO se traga. Se
 * convierte en `StorageFullError`, con un mensaje que el mecánico entiende, y
 * quien llama bloquea el guardado en vez de seguir como si nada.
 */

const DB_NAME = "mant-offline"
const DB_VERSION = 1

export const STORE = {
  meta: "meta",
  accounts: "accounts",
  catalogs: "catalogs",
  drafts: "drafts",
  queue: "queue",
  photos: "photos",
} as const
export type StoreName = (typeof STORE)[keyof typeof STORE]

export const STORAGE_FULL_MESSAGE =
  "El teléfono no tiene espacio para guardar esto. Libera espacio (borra fotos o aplicaciones que no uses) y vuelve a intentarlo."

export class StorageFullError extends Error {
  constructor(message: string = STORAGE_FULL_MESSAGE) {
    super(message)
    this.name = "StorageFullError"
  }
}

export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const { name, code } = error as { name?: unknown; code?: unknown }
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22
}

function toStorageError(error: unknown): Error {
  if (isQuotaError(error)) return new StorageFullError()
  return error instanceof Error ? error : new Error(String(error ?? "Error de almacenamiento"))
}

let connection: Promise<IDBDatabase> | null = null

/** Sólo para pruebas: cierra y olvida la conexión para que la siguiente reabra. */
export async function resetDbConnectionForTests(): Promise<void> {
  if (!connection) return
  const db = await connection.catch(() => null)
  db?.close()
  connection = null
}

export function openDb(): Promise<IDBDatabase> {
  if (connection) return connection
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Este navegador no deja guardar datos en el teléfono."))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE.meta)) db.createObjectStore(STORE.meta)
      if (!db.objectStoreNames.contains(STORE.accounts)) db.createObjectStore(STORE.accounts, { keyPath: "userId" })
      if (!db.objectStoreNames.contains(STORE.catalogs)) db.createObjectStore(STORE.catalogs, { keyPath: "userId" })
      if (!db.objectStoreNames.contains(STORE.drafts)) {
        const drafts = db.createObjectStore(STORE.drafts, { keyPath: "key" })
        drafts.createIndex("userId", "userId", { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE.queue)) {
        const queue = db.createObjectStore(STORE.queue, { keyPath: "id" })
        queue.createIndex("authorUserId", "authorUserId", { unique: false })
        queue.createIndex("status", "status", { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE.photos)) db.createObjectStore(STORE.photos, { keyPath: "id" })
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); connection = null }
      db.onclose = () => { connection = null }
      resolve(db)
    }
    request.onerror = () => { connection = null; reject(request.error ?? new Error("No se pudo abrir el almacenamiento")) }
    request.onblocked = () => { connection = null; reject(new Error("El almacenamiento está ocupado por otra pestaña. Ciérrala y reintenta.")) }
  })
  return connection
}

export function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Error de almacenamiento"))
  })
}

export type TxStores = Record<StoreName, IDBObjectStore>

/**
 * Corre `work` dentro de UNA transacción: o se guarda todo o no se guarda nada.
 * Dentro de `work` sólo se puede esperar peticiones de IndexedDB (`req`); cualquier
 * otra espera cierra la transacción.
 */
export async function runTx<T>(names: StoreName[], mode: IDBTransactionMode, work: (stores: TxStores) => Promise<T> | T): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    let result: T
    let failure: unknown = null
    let tx: IDBTransaction
    try {
      tx = db.transaction(names, mode)
    } catch (error) {
      reject(toStorageError(error))
      return
    }
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(toStorageError(failure ?? tx.error))
    const stores = Object.fromEntries(names.map((name) => [name, tx.objectStore(name)])) as TxStores
    Promise.resolve()
      .then(() => work(stores))
      .then((value) => { result = value }, (error) => {
        failure = error
        try { tx.abort() } catch { /* ya terminó */ }
      })
  })
}

export function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return runTx([store], "readonly", (s) => req(s[store].get(key)) as Promise<T | undefined>)
}

export function idbPut(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  return runTx([store], "readwrite", async (s) => { await req(key === undefined ? s[store].put(value) : s[store].put(value, key)) })
}

export function idbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  return runTx([store], "readwrite", async (s) => { await req(s[store].delete(key)) })
}

export function idbGetAll<T>(store: StoreName): Promise<T[]> {
  return runTx([store], "readonly", (s) => req(s[store].getAll()) as Promise<T[]>)
}

export function idbGetAllByIndex<T>(store: StoreName, index: string, query: IDBValidKey): Promise<T[]> {
  return runTx([store], "readonly", (s) => req(s[store].index(index).getAll(query)) as Promise<T[]>)
}

/**
 * lib/pwa/offline-queue.ts
 *
 * IndexedDB-backed offline queue for PPA submissions.
 * Stores form data when the browser is offline and syncs automatically
 * when connectivity is restored.
 *
 * Uses raw IndexedDB API (no external deps) so it works in both
 * Service Worker and main-thread contexts.
 */

const DB_NAME = "ppa-offline"
const DB_VERSION = 1
const STORE_NAME = "submissions"

// P2-2: cache the IDB connection to avoid re-opening on every call
let dbConnection: IDBDatabase | null = null

export interface QueuedPpa {
  id: string
  /** ISO timestamp when the submission was queued. */
  createdAt: string
  /** The full PPA form payload (matches ppaSubmitSchema). */
  payload: Record<string, unknown>
  /** "pending" | "syncing" | "synced" | "failed" */
  status: "pending" | "syncing" | "synced" | "failed"
  /** Number of sync attempts. */
  attempts: number
  /** Last error message, if any. */
  lastError?: string
  /** Token returned by server after successful sync. */
  token?: string
}

/* ── DB helpers ───────────────────────────────────────────────────────────── */

function openDb(): Promise<IDBDatabase> {
  // P2-2: return cached connection if still usable
  if (dbConnection) {
    return Promise.resolve(dbConnection)
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" })
        store.createIndex("status", "status", { unique: false })
        store.createIndex("createdAt", "createdAt", { unique: false })
      }
    }
    request.onsuccess = () => {
      dbConnection = request.result
      // Invalidate cache when DB is forcefully closed or version changes
      dbConnection.onclose = () => { dbConnection = null }
      dbConnection.onversionchange = () => { dbConnection?.close(); dbConnection = null }
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Execute a callback inside an active IndexedDB transaction.
 * The store is only valid inside the callback — do NOT return it.
 */
function withTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode)
        const store = transaction.objectStore(STORE_NAME)
        transaction.oncomplete = () => {} // no-op; promise resolved inside fn
        transaction.onerror = () => reject(transaction.error)

        try {
          const result = fn(store)
          if (result && typeof (result as Promise<T>).then === "function") {
            (result as Promise<T>).then(resolve, reject)
          } else {
            resolve(result as T)
          }
        } catch (e) {
          reject(e)
        }
      }),
  )
}

/* ── Public API ───────────────────────────────────────────────────────────── */

/** Add a PPA submission to the offline queue. */
export async function enqueuePpa(
  payload: Record<string, unknown>,
): Promise<QueuedPpa> {
  const item: QueuedPpa = {
    id: `ppa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    payload,
    status: "pending",
    attempts: 0,
  }
  return withTx("readwrite", (store) =>
    new Promise<QueuedPpa>((resolve, reject) => {
      const req = store.add(item)
      req.onsuccess = () => resolve(item)
      req.onerror = () => reject(req.error)
    }),
  )
}

/** Get all pending (unsynced) submissions. */
export async function getPendingPpas(): Promise<QueuedPpa[]> {
  return withTx("readonly", (store) => {
    const index = store.index("status")
    return new Promise<QueuedPpa[]>((resolve, reject) => {
      const req = index.getAll("pending")
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  })
}

/** Get a single submission by ID. */
export async function getPpaById(id: string): Promise<QueuedPpa | undefined> {
  return withTx("readonly", (store) =>
    new Promise<QueuedPpa | undefined>((resolve, reject) => {
      const req = store.get(id)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }),
  )
}

/** Update a submission's status. */
export async function updatePpaStatus(
  id: string,
  update: Partial<Pick<QueuedPpa, "status" | "lastError" | "attempts" | "token">>,
): Promise<void> {
  // P1-1: read + write in a single transaction to avoid TOCTOU race
  return withTx("readwrite", (store) =>
    new Promise<void>((resolve, reject) => {
      const getReq = store.get(id)
      getReq.onsuccess = () => {
        const existing = getReq.result as QueuedPpa | undefined
        if (!existing) { resolve(); return }
        const merged = { ...existing, ...update }
        const putReq = store.put(merged)
        putReq.onsuccess = () => resolve()
        putReq.onerror = () => reject(putReq.error)
      }
      getReq.onerror = () => reject(getReq.error)
    }),
  )
}

/** Delete a synced or failed submission. */
export async function deletePpa(id: string): Promise<void> {
  return withTx("readwrite", (store) =>
    new Promise<void>((resolve, reject) => {
      const req = store.delete(id)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    }),
  )
}

/** Count pending submissions. */
export async function countPendingPpas(): Promise<number> {
  return withTx("readonly", (store) => {
    const index = store.index("status")
    return new Promise<number>((resolve, reject) => {
      const req = index.count("pending")
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  })
}

/** Get all submissions (for UI display). */
export async function getAllPpas(): Promise<QueuedPpa[]> {
  return withTx("readonly", (store) =>
    new Promise<QueuedPpa[]>((resolve, reject) => {
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }),
  )
}

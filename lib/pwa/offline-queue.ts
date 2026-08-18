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
  /** Clave de idempotencia: es también `payload.clientSubmissionId`. */
  id: string
  /** ISO timestamp when the submission was queued. */
  createdAt: string
  /** ISO timestamp del último cambio de estado (base de recoverStalePpas). */
  updatedAt?: string
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

/**
 * Clave de idempotencia del envío. Se genera ANTES de intentar enviar (no al
 * encolar) para que el camino online y su respaldo offline compartan la misma:
 * si la acción falla por red DESPUÉS de que el servidor ya commiteó, el reenvío
 * desde la cola recupera esa fila en vez de crear un PPA duplicado.
 */
export function createPpaSubmissionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `ppa-${crypto.randomUUID()}`
    : `ppa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Add a PPA submission to the offline queue. */
export async function enqueuePpa(
  payload: Record<string, unknown>,
): Promise<QueuedPpa> {
  // La clave del payload manda: reencolar el mismo envío tiene que sobrescribir
  // su entrada, no crear una segunda con otra clave.
  const id = typeof payload.clientSubmissionId === "string" && payload.clientSubmissionId
    ? payload.clientSubmissionId
    : createPpaSubmissionId()
  const now = new Date().toISOString()
  // `filledAt` viaja EN el payload: es el único rastro de cuándo se llenó el PPA
  // en terreno. Sin él, un envío encolado el lunes y sincronizado el viernes se
  // archivaba como del viernes, y un PPA fechado después de la tarea que
  // pretendía prevenir no prueba nada ante una fiscalización.
  const basePayload = payload.clientSubmissionId === id ? payload : { ...payload, clientSubmissionId: id }
  const item: QueuedPpa = {
    id,
    createdAt: now,
    updatedAt: now,
    payload: typeof basePayload.filledAt === "string" ? basePayload : { ...basePayload, filledAt: now },
    status: "pending",
    attempts: 0,
  }
  await purgeExpiredPpas()
  await assertPpaQueueHasRoom(id)
  return withTx("readwrite", (store) =>
    new Promise<QueuedPpa>((resolve, reject) => {
      const req = store.put(item)
      req.onsuccess = () => resolve(item)
      req.onerror = () => reject(req.error)
    }),
  )
}

/**
 * Tope de entradas sin sincronizar. Era la única de las tres colas del repo sin
 * política de retención: una faena sin señal durante un turno podía encolar
 * cientos de PPA hasta reventar la cuota de IndexedDB, y ahí `store.put` empieza
 * a rechazar — se pierde el PPA justo cuando la cola importa. Se rechaza en vez
 * de desalojar: descartar en silencio un registro con valor probatorio sería
 * peor que negarse a aceptar uno nuevo.
 */
export const MAX_QUEUED_PPAS = 100
/** Un PPA sin sincronizar más viejo que esto ya no describe la tarea en curso. */
export const MAX_PPA_AGE_DAYS = 30

async function assertPpaQueueHasRoom(incomingId: string) {
  const all = await getAllPpas()
  const unsynced = all.filter((item) => item.status !== "synced" && item.id !== incomingId)
  if (unsynced.length >= MAX_QUEUED_PPAS) {
    throw new Error(
      `La cola offline está llena (${MAX_QUEUED_PPAS} evaluaciones sin sincronizar). ` +
      "Conéctate y sincroniza antes de registrar otra.",
    )
  }
}

/**
 * Expira por EDAD, con independencia de los reintentos. La limpieza previa
 * exigía `status === "failed" && attempts >= 3`, así que un `pending` viejo o un
 * `failed` con un intento eran residentes permanentes.
 */
export async function purgeExpiredPpas(): Promise<number> {
  const cutoff = Date.now() - MAX_PPA_AGE_DAYS * 86_400_000
  const all = await getAllPpas()
  const expired = all.filter((item) => Date.parse(item.createdAt) < cutoff)
  for (const item of expired) await deletePpa(item.id)
  return expired.length
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
        const merged = { ...existing, ...update, updatedAt: new Date().toISOString() }
        const putReq = store.put(merged)
        putReq.onsuccess = () => resolve()
        putReq.onerror = () => reject(putReq.error)
      }
      getReq.onerror = () => reject(getReq.error)
    }),
  )
}

/**
 * Recupera envíos que quedaron en `syncing` porque la app se cerró a mitad de
 * la sincronización. Sin esto el ítem no vuelve a aparecer nunca en
 * `getPendingPpas` (que sólo lee "pending") y la evaluación se pierde en
 * silencio. Reenviar es seguro: `clientSubmissionId` hace idempotente el envío
 * en el servidor. Mismo patrón que `recoverStaleTaeSubmissions`.
 */
export async function recoverStalePpas(
  now = Date.now(),
  staleMs = 5 * 60 * 1000,
): Promise<number> {
  return withTx("readwrite", (store) => {
    const index = store.index("status")
    return new Promise<number>((resolve, reject) => {
      const req = index.getAll("syncing")
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const stale = (req.result as QueuedPpa[]).filter((item) => {
          const at = new Date(item.updatedAt ?? item.createdAt).getTime()
          return !Number.isFinite(at) || now - at >= staleMs
        })
        for (const item of stale) {
          store.put({
            ...item,
            status: "pending",
            updatedAt: new Date(now).toISOString(),
            lastError: "Sincronización interrumpida; se reintentará.",
          })
        }
        resolve(stale.length)
      }
    })
  })
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

/**
 * Descarta los PPA locales al cerrar sesión. El payload lleva nombre, RUT y
 * empresa del trabajador: datos personales que no deben sobrevivir al cambio de
 * usuario en un dispositivo de faena compartido.
 */
export async function clearPpaQueue(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0
  const all = await getAllPpas()
  for (const item of all) await deletePpa(item.id)
  return all.length
}

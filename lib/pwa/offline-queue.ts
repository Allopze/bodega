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

import { nanoid } from "@/lib/id"
import type { QueueSnapshot } from "@/lib/pwa/heartbeat"

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
  /**
   * Por qué quedó en `failed`: `"rejected"` = el servidor lo rechazó (validación,
   * alcance, permiso: reintentar no lo arregla y hace falta una persona);
   * `"network"` = se agotaron los reintentos sin conexión (el envío en sí está
   * bien). TI sólo debe ver como «con error» lo primero. Los ítems guardados
   * antes de este campo no lo traen: ver `failureKindOf`.
   */
  failureKind?: "rejected" | "network"
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
  // PPA-003: la ruta de respaldo armaba `ppa-<Date.now()>-<8 caracteres de
  // Math.random>`. Esta clave gobierna la idempotencia del envío y, por
  // derivación HMAC, el enlace al resultado —reenviar con una clave existente
  // devuelve la fila y el enlace originales—, así que es una credencial de
  // capacidad y no puede salir de un PRNG no criptográfico: `Math.random` no
  // ofrece ninguna garantía de imprevisibilidad y el reloj aporta cero azar.
  //
  // `crypto.getRandomValues` (el que usa `nanoid`) está disponible en todo
  // contexto donde falta `randomUUID` —que sólo existe en contexto seguro y en
  // navegadores recientes—, así que el respaldo conserva la misma fuente de
  // entropía criptográfica. Si tampoco existe, se falla en vez de degradar:
  // encolar un PPA con una clave adivinable es peor que no encolarlo.
  if (typeof crypto === "undefined") {
    throw new Error("Este navegador no ofrece Web Crypto: no se puede generar una clave de envío segura.")
  }
  if ("randomUUID" in crypto) return `ppa-${crypto.randomUUID()}`
  return `ppa-${nanoid(24)}`
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
/**
 * Un PPA ya sincronizado, o rechazado por el servidor, se conserva este tiempo y
 * luego se borra. Los que no salieron (pending, syncing y los que se rindieron por
 * falta de red) NO caducan.
 */
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
 * Borra por EDAD sólo lo que ya no tiene nada que enviar: lo sincronizado y lo que
 * el servidor rechazó (`failed` con `failureKind` "rejected"; reintentar no lo
 * arregla y su payload lleva nombre y RUT del trabajador, así que no puede quedar
 * para siempre en el teléfono). Antes también borraba los `pending` y los `failed`
 * por red de más de 30 días: una evaluación de terreno que nunca salió (el teléfono
 * pasó un mes sin señal) desaparecía sin dejar rastro, y con ella la prueba de que
 * se hizo. Lo que sigue por enviar (pending, syncing, failed por red) se conserva
 * hasta que salga o una persona lo descarte; el techo de `MAX_QUEUED_PPAS` evita que
 * la cola crezca sin límite.
 */
export async function purgeExpiredPpas(): Promise<number> {
  const cutoff = Date.now() - MAX_PPA_AGE_DAYS * 86_400_000
  const all = await getAllPpas()
  const expired = all.filter((item) =>
    (item.status === "synced" || (item.status === "failed" && failureKindOf(item) === "rejected"))
    && Date.parse(item.createdAt) < cutoff,
  )
  for (const item of expired) await deletePpa(item.id)
  return expired.length
}

/**
 * Causa de un `failed`. Un ítem de antes de `failureKind` cuenta como rechazo,
 * salvo que su último error sea el «Sin conexión» que dejaba la falta de red.
 */
export function failureKindOf(item: Pick<QueuedPpa, "failureKind" | "lastError">): "rejected" | "network" {
  if (item.failureKind) return item.failureKind
  return item.lastError === "Sin conexión" ? "network" : "rejected"
}

/**
 * Lo que la cola le cuenta a TI (ver `lib/pwa/heartbeat.ts`). `failed` son sólo
 * los rechazos del servidor; lo que se rindió por falta de red sigue siendo
 * trabajo pendiente y cuenta en `pending`.
 */
export function summarizePpaQueue(items: readonly QueuedPpa[]): QueueSnapshot {
  let pending = 0
  let failed = 0
  let oldest: string | null = null
  let lastAttempt: string | null = null
  let lastError: { at: string; message: string } | null = null
  for (const item of items) {
    if (item.status === "synced") continue
    if (item.status === "failed" && failureKindOf(item) === "rejected") {
      failed++
    } else {
      pending++
      if (oldest === null || item.createdAt < oldest) oldest = item.createdAt
    }
    const touched = item.updatedAt ?? item.createdAt
    if (item.attempts > 0 && (lastAttempt === null || touched > lastAttempt)) lastAttempt = touched
    if (item.lastError && (lastError === null || touched > lastError.at)) lastError = { at: touched, message: item.lastError }
  }
  return { pending, failed, oldestPendingAt: oldest, lastAttemptAt: lastAttempt, lastError: lastError?.message ?? null }
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

/**
 * Devuelve a la fila (`pending`, sin intentos ni `failureKind`, conservando
 * `lastError`) lo que se rindió por falta de red: el envío está bien y sólo faltaba
 * señal. Un rechazo del servidor NO vuelve: necesita una persona. Es persistente
 * a propósito, para que la cola y los contadores lo vean como pendiente; se llama
 * sólo al abrir la app y al volver la señal (ver `usePpaOfflineQueue`), nunca en
 * cada pasada, o un servidor caído con el teléfono «en línea» haría un bucle
 * cerrado de reintentos. Devuelve cuántos reencoló.
 */
export async function requeueNetworkFailedPpas(): Promise<number> {
  return withTx("readwrite", (store) =>
    new Promise<number>((resolve, reject) => {
      const req = store.index("status").getAll("failed")
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const network = (req.result as QueuedPpa[]).filter((item) => failureKindOf(item) === "network")
        const updatedAt = new Date().toISOString()
        for (const item of network) {
          store.put({ ...item, status: "pending", attempts: 0, failureKind: undefined, updatedAt })
        }
        resolve(network.length)
      }
    }),
  )
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
  update: Partial<Pick<QueuedPpa, "status" | "lastError" | "attempts" | "token" | "failureKind">>,
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

/**
 * Lo que el trabajador todavía no logra enviar: `pending` + `syncing` + `failed`
 * por falta de red. Es lo que muestran el aviso y «Enviar ahora»; `getPendingPpas`
 * (sólo `pending`) no alcanza, porque un ítem que se rindió por red desaparecía de
 * la pantalla sin haber llegado nunca. Los rechazos del servidor no cuentan: no
 * se arreglan reintentando.
 */
export async function getUnsentPpas(): Promise<QueuedPpa[]> {
  const all = await getAllPpas()
  return all.filter((item) =>
    item.status === "pending"
    || item.status === "syncing"
    || (item.status === "failed" && failureKindOf(item) === "network"),
  )
}

export async function countUnsentPpas(): Promise<number> {
  return (await getUnsentPpas()).length
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

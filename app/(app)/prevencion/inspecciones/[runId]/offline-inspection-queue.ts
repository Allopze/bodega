/**
 * Cola offline de ejecuciones de inspección (función #9).
 *
 * La idempotencia del servidor ya existía: `clientSubmissionId`, su índice
 * único parcial y el retorno `idempotentReplay`. Lo que faltaba era el cliente
 * — nada la usaba nunca.
 *
 * Alcance deliberado: encola el CIERRE de una inspección ya creada y abierta en
 * el dispositivo. No se soporta crear inspecciones offline, porque exigiría
 * sincronizar el catálogo de plantillas y resolver conflictos de programa —
 * mucho más superficie por un caso que en terreno se resuelve descargando la
 * inspección antes de salir.
 *
 * Mismo contrato que `offline-incident-queue.ts`: purga por edad O reintentos
 * (no AND), mutex de módulo contra doble flush, y `sender` que distingue el
 * rechazo permanente del fallo de red. Un elemento venenoso que gasta los 8
 * reintentos quedaría como zombi invisible durante 30 días.
 */
import { nanoid } from "@/lib/id"

export interface OfflineInspectionSubmission {
  clientSubmissionId: string
  runId: string
  expectedVersion: number
  answers: {
    sectionId: string
    itemId: string
    result: string
    value?: string | null
    comment?: string | null
  }[]
  locationLatitude?: string | null
  locationLongitude?: string | null
  closingAct?: {
    result: string
    restrictions?: string | null
    signatures: { role: string; name: string; userId?: string | null }[]
  }
  /** Momento del encolado en terreno, para distinguir "ejecutó tarde" de "sincronizó tarde". */
  queuedAt?: string
}

interface QueueEntry {
  id: string
  payload: OfflineInspectionSubmission
  queuedAt: string
  attempts: number
  lastError?: string
}

const DB_NAME = "chome-prevention-offline"
// Comparte base con la cola de incidentes: subir la versión crea el store
// nuevo sin tocar el existente (`onupgradeneeded` sólo añade el que falta).
const DB_VERSION = 2
const STORE = "inspection-submissions"
const INCIDENT_STORE = "incident-reports"
/** Tope bajo: cada entrada puede traer decenas de respuestas y su acta. */
const MAX_QUEUED = 5
const MAX_AGE_DAYS = 30
const MAX_RETRIES = 8

let flushLock: Promise<unknown> | null = null

function openQueueDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      // Ambos stores se declaran aquí: al subir de v1 a v2 el navegador ejecuta
      // este handler y el de incidentes ya existe, así que sólo se crea el nuevo.
      if (!database.objectStoreNames.contains(INCIDENT_STORE)) database.createObjectStore(INCIDENT_STORE, { keyPath: "id" })
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir la cola offline."))
  })
}

function transactionPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Error de almacenamiento offline."))
  })
}

export function createInspectionSubmissionId() {
  return `offline-${nanoid()}`
}

export async function queueInspectionSubmission(payload: OfflineInspectionSubmission) {
  const database = await openQueueDatabase()
  try {
    const store = database.transaction(STORE, "readwrite").objectStore(STORE)
    const all = await transactionPromise(store.getAll()) as QueueEntry[]

    // Dos políticas SEPARADAS, no una con `&&`: entradas viejas que nunca se
    // reintentaron (dispositivo apagado) tienen que purgarse igual, o llenan la
    // cola y bloquean la siguiente inspección justo cuando se necesita.
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000)
    const isExpired = (entry: QueueEntry) => new Date(entry.queuedAt) < cutoff
    const isDead = (entry: QueueEntry) => entry.attempts >= MAX_RETRIES
    for (const entry of all) {
      if (isExpired(entry) || isDead(entry)) await transactionPromise(store.delete(entry.id))
    }

    const remaining = all.filter((entry) => !isExpired(entry) && !isDead(entry))
    // Reencolar la misma inspección reemplaza su entrada, no suma otra.
    if (remaining.length >= MAX_QUEUED && !remaining.some((entry) => entry.payload.runId === payload.runId)) {
      throw new Error(`La cola offline está llena (${MAX_QUEUED} inspecciones sin sincronizar). Conéctate y sincroniza antes de cerrar otra.`)
    }

    const queuedAt = new Date().toISOString()
    const entry: QueueEntry = {
      // Por `runId`: una inspección tiene una sola ejecución pendiente de envío.
      id: payload.runId,
      payload: { ...payload, queuedAt },
      queuedAt,
      attempts: 0,
    }
    await transactionPromise(store.put(entry))
    return entry
  } finally {
    database.close()
  }
}

export async function listQueuedInspectionSubmissions() {
  if (typeof indexedDB === "undefined") return []
  const database = await openQueueDatabase()
  try {
    return await transactionPromise(database.transaction(STORE).objectStore(STORE).getAll()) as QueueEntry[]
  } finally {
    database.close()
  }
}

export async function flushInspectionSubmissionQueue(
  sender: (payload: OfflineInspectionSubmission) => Promise<{ ok: boolean; message?: string; retriable?: boolean }>,
) {
  if (flushLock) await flushLock
  let resolveLock: () => void
  flushLock = new Promise<void>((resolve) => { resolveLock = resolve })

  try {
    const entries = await listQueuedInspectionSubmissions()
    const result = { synchronized: 0, pending: 0, rejected: 0 }
    for (const entry of entries) {
      if (entry.attempts >= MAX_RETRIES) {
        result.rejected++
        continue
      }
      try {
        const response = await sender(entry.payload)
        const database = await openQueueDatabase()
        try {
          if (response.ok) {
            await transactionPromise(database.transaction(STORE, "readwrite").objectStore(STORE).delete(entry.id))
            result.synchronized++
          } else {
            // Validación, permiso o "ya fue ejecutada": reintentarlo no lo
            // arregla. Se quema de golpe y se avisa, nunca en silencio.
            const permanent = response.retriable === false
            await transactionPromise(database.transaction(STORE, "readwrite").objectStore(STORE).put({
              ...entry,
              attempts: permanent ? MAX_RETRIES : entry.attempts + 1,
              lastError: response.message ?? "Sincronización rechazada",
            }))
            if (permanent) result.rejected++
            else result.pending++
          }
        } finally {
          database.close()
        }
      } catch (error) {
        const database = await openQueueDatabase()
        try {
          await transactionPromise(database.transaction(STORE, "readwrite").objectStore(STORE).put({
            ...entry,
            attempts: entry.attempts + 1,
            lastError: error instanceof Error ? error.message : "Sin conexión",
          }))
        } finally {
          database.close()
        }
        result.pending++
      }
    }
    return result
  } finally {
    resolveLock!()
    flushLock = null
  }
}

/**
 * Descarta la cola local. Se llama al cerrar sesión: las respuestas de una
 * inspección y el acta con nombres de quienes firman viven en claro en
 * IndexedDB hasta 30 días, en dispositivos que en faena suelen compartirse.
 */
export async function clearInspectionSubmissionQueue(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0
  const database = await openQueueDatabase()
  try {
    const store = database.transaction(STORE, "readwrite").objectStore(STORE)
    const all = await transactionPromise(store.getAll()) as QueueEntry[]
    await transactionPromise(store.clear())
    return all.length
  } finally {
    database.close()
  }
}

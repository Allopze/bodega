export interface QueuedPerson {
  workerId?: string
  workerName?: string
  displayLabel?: string
  employerName: string
  relationshipType: string
  identificationHint?: string
  absenceAtLeastNormalShift?: boolean
  absenceDays?: number
  chargeDays?: number
}

export interface OfflineIncidentReport {
  clientSubmissionId: string
  worksiteId: string
  companyName: string
  eventType: string
  occurredAt: string
  knownAt: string
  location: string
  initialNarrative: string
  actualSeverity: string
  potentialSeverity: string
  immediateMeasures: string | null
  operationsSuspended: boolean
  evacuated: boolean
  isFatalOrSerious: boolean
  offlineSync: boolean
  /**
   * Momento del encolado en terreno. Viaja al servidor para poder distinguir
   * "se reportó tarde" de "se sincronizó tarde": las bandas DIAT/DIEP se
   * calculan sobre `knownAt`, así que un reporte encolado 24 días nace vencido
   * y sin este dato no hay forma de saber que el trabajador sí reportó a tiempo.
   */
  queuedAt?: string
  people: QueuedPerson[]
}

interface QueueEntry {
  id: string
  payload: OfflineIncidentReport
  queuedAt: string
  attempts: number
  lastError?: string
}

const DB_NAME = "chome-prevention-offline"
const DB_VERSION = 1
const STORE = "incident-reports"
const MAX_QUEUED = 25
const MAX_AGE_DAYS = 30
const MAX_RETRIES = 8

let flushLock: Promise<unknown> | null = null

function openQueueDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
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

export function createIncidentSubmissionId() {
  return `offline-${crypto.randomUUID()}`
}

export async function queueIncidentReport(payload: OfflineIncidentReport) {
  const database = await openQueueDatabase()
  try {
    const store = database.transaction(STORE, "readwrite").objectStore(STORE)
    const all = await transactionPromise(store.getAll()) as QueueEntry[]

    // Dos políticas SEPARADAS. Antes era una sola condición con `&&`
    // (reintentos agotados Y 30 días), así que 25 reportes viejos que nunca se
    // reintentaron —dispositivo apagado— no se purgaban nunca y bloqueaban todo
    // reporte nuevo: el formulario quedaba inutilizable en terreno justo cuando
    // se necesita.
    const now = new Date()
    const cutoff = new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000)
    const isExpired = (entry: QueueEntry) => new Date(entry.queuedAt) < cutoff
    const isDead = (entry: QueueEntry) => entry.attempts >= MAX_RETRIES
    for (const entry of all) {
      if (isExpired(entry) || isDead(entry)) {
        await transactionPromise(store.delete(entry.id))
      }
    }

    const remaining = all.filter((e) => !isExpired(e) && !isDead(e))
    if (remaining.length >= MAX_QUEUED) {
      throw new Error(`La cola offline está llena (${MAX_QUEUED} reportes sin sincronizar). Conéctate y sincroniza antes de registrar otro.`)
    }

    const queuedAt = new Date().toISOString()
    const entry: QueueEntry = {
      id: payload.clientSubmissionId,
      payload: { ...payload, offlineSync: true, queuedAt },
      queuedAt,
      attempts: 0,
    }
    await transactionPromise(store.put(entry))
    return entry
  } finally {
    database.close()
  }
}

export async function listQueuedIncidentReports() {
  const database = await openQueueDatabase()
  try {
    return await transactionPromise(database.transaction(STORE).objectStore(STORE).getAll()) as QueueEntry[]
  } finally {
    database.close()
  }
}

/**
 * Vacía la cola. `sender` distingue el rechazo PERMANENTE (validación, permiso,
 * clave ya usada: reintentarlo no lo arregla) del fallo transitorio de red. Sin
 * esa distinción, un elemento venenoso gastaba los 8 reintentos y quedaba como
 * zombi invisible inflando el contador "Sincronizar (n)" durante 30 días.
 */
export async function flushIncidentReportQueue(
  sender: (payload: OfflineIncidentReport) => Promise<{ ok: boolean; message?: string; retriable?: boolean }>,
) {
  if (flushLock) await flushLock
  let resolveLock: () => void
  flushLock = new Promise<void>((resolve) => { resolveLock = resolve })

  try {
    const entries = await listQueuedIncidentReports()
    const result = { synchronized: 0, pending: 0, rejected: 0 }
    for (const entry of entries) {
      if (entry.attempts >= MAX_RETRIES) {
        // Ya agotado: se cuenta aparte para que la UI pueda decir que ese
        // reporte NUNCA se va a enviar, en vez de mostrarlo como pendiente.
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
 * Descarta la cola local. Se llama al cerrar sesión: el relato de un incidente
 * (hasta 10.000 caracteres describiendo un accidente con personas), el nombre
 * del trabajador y su referencia de identificación viven en claro en IndexedDB
 * hasta 30 días, en dispositivos que en faena suelen compartirse. El servidor
 * cifra ese mismo dato en reposo; el navegador no puede, así que al menos no se
 * queda para el siguiente usuario.
 *
 * Devuelve cuántas entradas sin sincronizar se perdieron, para poder avisar.
 */
export async function clearIncidentReportQueue(): Promise<number> {
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

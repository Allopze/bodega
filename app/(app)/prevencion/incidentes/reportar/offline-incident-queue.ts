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
  people: unknown[]
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
    const entry: QueueEntry = {
      id: payload.clientSubmissionId,
      payload: { ...payload, offlineSync: true },
      queuedAt: new Date().toISOString(),
      attempts: 0,
    }
    await transactionPromise(database.transaction(STORE, "readwrite").objectStore(STORE).put(entry))
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

export async function flushIncidentReportQueue(
  sender: (payload: OfflineIncidentReport) => Promise<{ ok: boolean; message?: string }>,
) {
  const entries = await listQueuedIncidentReports()
  const result = { synchronized: 0, pending: 0 }
  for (const entry of entries) {
    try {
      const response = await sender(entry.payload)
      const database = await openQueueDatabase()
      try {
        if (response.ok) {
          await transactionPromise(database.transaction(STORE, "readwrite").objectStore(STORE).delete(entry.id))
          result.synchronized++
        } else {
          await transactionPromise(database.transaction(STORE, "readwrite").objectStore(STORE).put({
            ...entry,
            attempts: entry.attempts + 1,
            lastError: response.message ?? "Sincronización rechazada",
          }))
          result.pending++
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
}

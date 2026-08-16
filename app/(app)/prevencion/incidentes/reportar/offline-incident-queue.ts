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

    // Purgar expirados y retry-max-out
    const now = new Date()
    const cutoff = new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000)
    for (const entry of all) {
      if (entry.attempts >= MAX_RETRIES && new Date(entry.queuedAt) < cutoff) {
        await transactionPromise(store.delete(entry.id))
      }
    }

    const remaining = all.filter((e) => !(e.attempts >= MAX_RETRIES && new Date(e.queuedAt) < cutoff))
    if (remaining.length >= MAX_QUEUED) {
      throw new Error(`La cola offline está llena (${MAX_QUEUED} reportes sin sincronizar). Conéctate y sincroniza antes de registrar otro.`)
    }

    const entry: QueueEntry = {
      id: payload.clientSubmissionId,
      payload: { ...payload, offlineSync: true },
      queuedAt: new Date().toISOString(),
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

export async function flushIncidentReportQueue(
  sender: (payload: OfflineIncidentReport) => Promise<{ ok: boolean; message?: string }>,
) {
  if (flushLock) await flushLock
  let resolveLock: () => void
  flushLock = new Promise<void>((resolve) => { resolveLock = resolve })

  try {
    const entries = await listQueuedIncidentReports()
    const result = { synchronized: 0, pending: 0 }
    for (const entry of entries) {
      if (entry.attempts >= MAX_RETRIES) {
        result.pending++
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
  } finally {
    resolveLock!()
    flushLock = null
  }
}

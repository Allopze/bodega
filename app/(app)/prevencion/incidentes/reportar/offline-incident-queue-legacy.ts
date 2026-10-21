/** Lectura de la cola RE-20 v2 en claro (sin dueño), sólo para migrarla al almacén de borradores por usuario. */
interface LegacyQueueEntry<T = unknown> {
  id: string
  payload: T
  queuedAt: string
  attempts: number
  lastError?: string
}

const DB_NAME = "chome-prevention-offline"
const DB_VERSION = 2
const STORE = "incident-reports"
const INSPECTION_STORE = "inspection-submissions"

function openLegacyDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB no está disponible."))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "id" })
      if (!database.objectStoreNames.contains(INSPECTION_STORE)) database.createObjectStore(INSPECTION_STORE, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir la cola antigua."))
  })
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("No se pudo leer la cola antigua."))
  })
}

export async function listLegacyIncidentReports<T = unknown>() {
  const database = await openLegacyDatabase()
  try {
    return await requestResult(database.transaction(STORE).objectStore(STORE).getAll()) as LegacyQueueEntry<T>[]
  } finally {
    database.close()
  }
}

export async function clearLegacyIncidentReports() {
  const database = await openLegacyDatabase()
  try {
    await requestResult(database.transaction(STORE, "readwrite").objectStore(STORE).clear())
  } finally {
    database.close()
  }
}

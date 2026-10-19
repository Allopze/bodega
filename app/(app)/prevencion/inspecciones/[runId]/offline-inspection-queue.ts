/**
 * Cola offline de ejecuciones de inspección (función #9).
 *
 * La idempotencia del reintento la da el servidor: `completeInspectionRun`
 * devuelve el run como éxito cuando ya quedó ejecutado por ESTE usuario, así
 * que un eco de la cola no duplica nada y la entrada puede borrarse.
 *
 * NO la da `clientSubmissionId`: ese campo y su índice único parcial sólo
 * gobiernan la CREACIÓN de la inspección (`createInspectionRun`), y el Zod del
 * cierre ni siquiera lo declara — viajaba y se descartaba en silencio
 * (INS-19). Se dejó de mandar.
 *
 * Alcance deliberado: encola el CIERRE de una inspección ya creada y abierta en
 * el dispositivo. No se soporta crear inspecciones offline, porque exigiría
 * sincronizar el catálogo de plantillas y resolver conflictos de programa —
 * mucho más superficie por un caso que en terreno se resuelve descargando la
 * inspección antes de salir.
 *
 * Mismo contrato que `offline-incident-queue.ts`: purga por edad, flush
 * serializado a nivel de módulo, y `sender` que distingue el rechazo permanente
 * del fallo de red.
 *
 * Qué hace el flush con la respuesta del `sender` (P1-5):
 *   - `ok`                        → la entrada se borra.
 *   - `ok:false` con código       → rechazo PERMANENTE: se quema de golpe con su
 *     (`data.code` / `code`)        mensaje y su código. Reintentar un conflicto
 *                                   de versión o una ejecución ya no editable
 *                                   no lo arregla; sólo quien ejecutó puede
 *                                   decidir qué hacer (recuperar el cierre o
 *                                   descartarlo).
 *   - `ok:false` sin código, o    → REINTENTABLE: suma un intento y la entrada
 *     el `sender` lanza             sigue pendiente, acotada por `MAX_RETRIES`.
 *
 * El resultado del flush cuenta por separado las entradas que se quemaron en
 * ESTA pasada (`rejected` + `rejectedRunIds`) y las que ya venían quemadas
 * (`dead`): antes ambas se sumaban en `rejected` y un cierre ya descartado
 * seguía diciendo «1 pendiente» en cada «Sincronizar».
 */

import { saveErrorCodeOf, type InspectionErrorCode } from "@/lib/prevention/inspection-capture"

export interface OfflineInspectionSubmission {
  runId: string
  expectedVersion: number
  answers: {
    sectionId: string
    itemId: string
    result: string
    value?: string | null
    comment?: string | null
    /** La marca la ingesta al pre-llenar un ítem `fatal`; viaja para que el
     *  servidor pueda bloquear el cierre de lo que nadie ratificó. */
    needsConfirmation?: boolean
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

export interface QueuedInspectionSubmission {
  id: string
  payload: OfflineInspectionSubmission
  queuedAt: string
  attempts: number
  lastError?: string
  /** Código del rechazo permanente que quemó la entrada; no existe si se agotaron los reintentos. */
  lastCode?: InspectionErrorCode
}

type QueueEntry = QueuedInspectionSubmission

/**
 * Lo que el `sender` informa de un envío. Acepta el `ActionState` de la acción
 * tal cual (el código viaja en `data.code`) o el código ya extraído en `code`.
 */
export interface InspectionSubmissionSendResult {
  ok: boolean
  message?: string
  /** `false` fuerza el rechazo permanente aunque no traiga código (llamadores previos al código). */
  retriable?: boolean
  code?: string | null
  data?: Record<string, unknown>
}

export type InspectionSubmissionSender = (payload: OfflineInspectionSubmission) => Promise<InspectionSubmissionSendResult>

export interface InspectionQueueFlushResult {
  /** Entradas entregadas y borradas. */
  synchronized: number
  /** Entradas que fallaron por red o sin código y siguen en la cola para otro intento. */
  pending: number
  /** Entradas que se quemaron en ESTA pasada (rechazo permanente o reintentos agotados). */
  rejected: number
  /** Entradas que ya venían quemadas de antes: no se reenvían ni se vuelven a contar como rechazo. */
  dead: number
  /** `runId` de las entradas contadas en `rejected`, para avisar una sola vez a quien las mira. */
  rejectedRunIds: string[]
}

/** La cola está llena de inspecciones sin sincronizar: se distingue de un fallo de almacenamiento. */
export class OfflineQueueFullError extends Error {
  constructor(max: number) {
    super(`La cola offline está llena (${max} inspecciones sin sincronizar). Conéctate y sincroniza antes de cerrar otra.`)
    this.name = "OfflineQueueFullError"
  }
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

/** Cadena de flushes: cada uno espera al anterior (un solo vuelo a la vez en esta pestaña). */
let flushChain: Promise<unknown> = Promise.resolve()

/** Una entrada quemada (rechazo permanente o reintentos agotados): ya no se reenvía. */
export function isInspectionSubmissionRejected(entry: Pick<QueueEntry, "attempts">) {
  return entry.attempts >= MAX_RETRIES
}

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

export async function queueInspectionSubmission(payload: OfflineInspectionSubmission) {
  const database = await openQueueDatabase()
  try {
    const store = database.transaction(STORE, "readwrite").objectStore(STORE)
    const all = await transactionPromise(store.getAll()) as QueueEntry[]

    // La edad purga siempre: entradas viejas que nunca se reintentaron
    // (dispositivo apagado) llenarían la cola y bloquearían la siguiente
    // inspección justo cuando se necesita.
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000)
    const isExpired = (entry: QueueEntry) => new Date(entry.queuedAt) < cutoff
    for (const entry of all) {
      if (isExpired(entry)) await transactionPromise(store.delete(entry.id))
    }

    let remaining = all.filter((entry) => !isExpired(entry))
    // Reencolar la misma inspección reemplaza su entrada, no suma otra.
    if (remaining.length >= MAX_QUEUED && !remaining.some((entry) => entry.payload.runId === payload.runId)) {
      // Una entrada quemada es el cierre que alguien todavía tiene que recuperar
      // o descartar desde su pantalla: borrarla en silencio al encolar OTRA
      // inspección dejaba a quien la ejecutó sin el cierre y sin aviso. Sólo se
      // desaloja, de la más vieja a la más nueva, cuando hace falta el lugar.
      const burned = remaining.filter(isInspectionSubmissionRejected).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
      for (const entry of burned) {
        if (remaining.length < MAX_QUEUED) break
        await transactionPromise(store.delete(entry.id))
        remaining = remaining.filter((other) => other.id !== entry.id)
      }
      if (remaining.length >= MAX_QUEUED) throw new OfflineQueueFullError(MAX_QUEUED)
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

/** La entrada pendiente de una inspección, o `null`. La clave de la cola ES el `runId`. */
export async function getQueuedInspectionSubmission(runId: string): Promise<QueueEntry | null> {
  if (typeof indexedDB === "undefined") return null
  const database = await openQueueDatabase()
  try {
    const entry = await transactionPromise(database.transaction(STORE).objectStore(STORE).get(runId)) as QueueEntry | undefined
    return entry ?? null
  } finally {
    database.close()
  }
}

/**
 * Borra la entrada de una inspección sin enviarla: la salida de quien prefiere
 * rehacer el cierre antes que reintentar uno rechazado. `true` si existía.
 */
export async function discardQueuedInspectionSubmission(runId: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false
  const database = await openQueueDatabase()
  try {
    const store = database.transaction(STORE, "readwrite").objectStore(STORE)
    const existing = await transactionPromise(store.get(runId)) as QueueEntry | undefined
    if (!existing) return false
    await transactionPromise(store.delete(runId))
    return true
  } finally {
    database.close()
  }
}

/** Código con que el servidor rechazó el envío, venga en `code` o en `data.code` del `ActionState`. */
function rejectionCodeOf(response: InspectionSubmissionSendResult): InspectionErrorCode | null {
  return saveErrorCodeOf({
    ok: false,
    data: { ...response.data, ...(response.code ? { code: response.code } : {}) },
  })
}

/**
 * Texto de un envío que ni siquiera obtuvo respuesta. Un `TypeError` de red trae
 * el mensaje del navegador en inglés («Failed to fetch»); se reemplaza para que
 * lo que queda en `lastError` se pueda mostrar tal cual.
 */
function transportFailureMessage(error: unknown) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false
  if (offline || (error instanceof TypeError && /failed to fetch|fetch failed|network|load failed/i.test(error.message))) {
    return "Sin conexión con el servidor"
  }
  return error instanceof Error && error.message ? error.message : "Sin conexión"
}

/**
 * Anota un fallo sobre la entrada. Relee y reescribe en UNA transacción y sólo
 * si sigue siendo la misma entrada que se envió: otra pestaña pudo entregarla
 * mientras tanto (no se debe resucitar quemada) o quien ejecutó pudo reencolar
 * un cierre nuevo (no se debe quemar con el error del anterior).
 * Devuelve la entrada ya actualizada, o `null` si no se tocó.
 */
async function recordSendFailure(
  entry: QueueEntry,
  failure: { permanent: boolean; message: string; code: InspectionErrorCode | null },
): Promise<QueueEntry | null> {
  const database = await openQueueDatabase()
  try {
    const store = database.transaction(STORE, "readwrite").objectStore(STORE)
    const current = await transactionPromise(store.get(entry.id)) as QueueEntry | undefined
    if (!current || current.queuedAt !== entry.queuedAt) return null
    const next: QueueEntry = {
      ...current,
      attempts: failure.permanent ? MAX_RETRIES : current.attempts + 1,
      lastError: failure.message,
      ...(failure.code ? { lastCode: failure.code } : {}),
    }
    await transactionPromise(store.put(next))
    return next
  } finally {
    database.close()
  }
}

async function deleteQueuedEntry(id: string) {
  const database = await openQueueDatabase()
  try {
    await transactionPromise(database.transaction(STORE, "readwrite").objectStore(STORE).delete(id))
  } finally {
    database.close()
  }
}

async function flushOnce(sender: InspectionSubmissionSender): Promise<InspectionQueueFlushResult> {
  const entries = await listQueuedInspectionSubmissions()
  const result: InspectionQueueFlushResult = { synchronized: 0, pending: 0, rejected: 0, dead: 0, rejectedRunIds: [] }
  for (const entry of entries) {
    if (isInspectionSubmissionRejected(entry)) {
      result.dead++
      continue
    }

    let response: InspectionSubmissionSendResult
    try {
      response = await sender(entry.payload)
    } catch (error) {
      // Sin red o excepción del transporte: no hay veredicto del servidor, así
      // que es reintentable. La acotan los `MAX_RETRIES`.
      const failed = await recordSendFailure(entry, { permanent: false, message: transportFailureMessage(error), code: null })
      if (!failed) continue
      if (isInspectionSubmissionRejected(failed)) {
        result.rejected++
        result.rejectedRunIds.push(failed.payload.runId)
      } else {
        result.pending++
      }
      continue
    }

    if (response.ok) {
      await deleteQueuedEntry(entry.id)
      result.synchronized++
      continue
    }

    // Con código (conflicto de versión, ya no editable, falta algo…) o con
    // `retriable: false`, reintentarlo no lo arregla: se quema de golpe y se
    // avisa, nunca en silencio. Sin código es un fallo que puede ceder.
    const code = rejectionCodeOf(response)
    const permanent = code !== null || response.retriable === false
    const failed = await recordSendFailure(entry, {
      permanent,
      message: response.message ?? "Sincronización rechazada",
      code,
    })
    if (!failed) continue
    if (isInspectionSubmissionRejected(failed)) {
      result.rejected++
      result.rejectedRunIds.push(failed.payload.runId)
    } else {
      result.pending++
    }
  }
  return result
}

/**
 * Envía lo pendiente, de a una entrada. Las llamadas se encadenan: dos
 * `flush` simultáneos (montaje + evento `online`) no mandan la misma entrada a
 * la vez. La espera anterior también se encadena, a diferencia de un candado
 * que dos esperando liberaban juntos.
 */
export function flushInspectionSubmissionQueue(sender: InspectionSubmissionSender): Promise<InspectionQueueFlushResult> {
  const run = flushChain.then(() => flushOnce(sender))
  flushChain = run.catch(() => undefined)
  return run
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

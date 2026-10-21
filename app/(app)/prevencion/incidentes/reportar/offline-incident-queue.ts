import { nanoid } from "@/lib/id"
import {
  deleteRe20OfflineDraft,
  getRe20OfflineDraft,
  listRe20OfflineDrafts,
  purgeRe20OfflineDrafts,
  putRe20OfflineDraft,
  type OfflineDraft,
} from "@/lib/prevention/re20-offline-drafts"
import { clearLegacyIncidentReports, listLegacyIncidentReports } from "./offline-incident-queue-legacy"

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
  queuedAt?: string
  people: QueuedPerson[]
}

export interface QueueEntry extends OfflineDraft<OfflineIncidentReport> {
  kind: "incident_report"
}

export function createIncidentSubmissionId() {
  return `offline-${nanoid()}`
}

function draftId(reportId: string) {
  return `incident-report:${reportId}`
}

/**
 * Pasa la cola antigua (v2, en claro y sin dueño) al almacén de borradores de
 * `userId`. Es de esa persona porque el cierre de sesión vacía esa cola: lo que
 * sobrevive lo guardó la sesión que sigue abierta.
 */
export async function migrateLegacyIncidentReportQueue(userId: string) {
  const legacy = await listLegacyIncidentReports<OfflineIncidentReport>()
  if (legacy.length === 0) return 0
  for (const entry of legacy) {
    const id = draftId(entry.payload.clientSubmissionId)
    await putRe20OfflineDraft(userId, {
      id,
      kind: "incident_report",
      payload: { ...entry.payload, offlineSync: true, queuedAt: entry.queuedAt },
      createdAt: entry.queuedAt,
      updatedAt: new Date().toISOString(),
      attempts: entry.attempts,
      ...(entry.lastError ? { lastError: entry.lastError } : {}),
    })
    const verified = await getRe20OfflineDraft<OfflineIncidentReport>(userId, id)
    if (verified?.payload.clientSubmissionId !== entry.payload.clientSubmissionId) {
      throw new Error("No se pudo verificar un reporte antiguo; la cola original se conservó.")
    }
  }
  await clearLegacyIncidentReports()
  return legacy.length
}

export async function queueIncidentReport(userId: string, payload: OfflineIncidentReport) {
  const queuedAt = payload.queuedAt ?? new Date().toISOString()
  const entry = {
    id: draftId(payload.clientSubmissionId),
    kind: "incident_report" as const,
    payload: { ...payload, offlineSync: true, queuedAt },
    createdAt: queuedAt,
    updatedAt: new Date().toISOString(),
    attempts: 0,
  }
  await putRe20OfflineDraft(userId, entry)
  const verified = await getRe20OfflineDraft<OfflineIncidentReport>(userId, entry.id)
  if (verified?.payload.clientSubmissionId !== payload.clientSubmissionId) {
    throw new Error("No se pudo verificar el reporte guardado en este equipo; el formulario conserva los datos.")
  }
  return entry
}

export async function listQueuedIncidentReports(userId: string): Promise<QueueEntry[]> {
  const drafts = await listRe20OfflineDrafts<OfflineIncidentReport>(userId)
  return drafts.filter((draft): draft is QueueEntry => draft.kind === "incident_report")
}

export interface IncidentQueueFlushResult {
  /** Entregados y borrados. */
  synchronized: number
  /** Siguen en la cola para otro intento (sin red, fallo transitorio). */
  pending: number
  /** El servidor los rechazó en ESTA pasada: quedan marcados y ya no se reenvían solos. */
  rejected: number
}

type IncidentReportSender = (payload: OfflineIncidentReport) => Promise<{ ok: boolean; message?: string; retriable?: boolean }>

/** Cadena de envíos: el montaje y el evento `online` no mandan la misma entrada a la vez. */
let flushChain: Promise<unknown> = Promise.resolve()

async function flushOnce(userId: string, sender: IncidentReportSender): Promise<IncidentQueueFlushResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const pending = (await listQueuedIncidentReports(userId)).filter((entry) => !entry.rejected).length
    return { synchronized: 0, pending, rejected: 0 }
  }
  const entries = await listQueuedIncidentReports(userId)
  const result: IncidentQueueFlushResult = { synchronized: 0, pending: 0, rejected: 0 }
  for (const entry of entries) {
    // Un rechazo permanente no se arregla reenviando: queda a la vista de quien lo escribió.
    if (entry.rejected) continue
    try {
      const response = await sender(entry.payload)
      if (response.ok) {
        await deleteRe20OfflineDraft(userId, entry.id)
        result.synchronized++
        continue
      }
      const rejected = response.retriable === false
      await putRe20OfflineDraft(userId, {
        ...entry,
        updatedAt: new Date().toISOString(),
        attempts: entry.attempts + 1,
        lastError: response.message ?? (rejected ? "El servidor rechazó el reporte." : "Sin conexión"),
        ...(rejected ? { rejected: true } : {}),
      })
      if (rejected) result.rejected++
      else result.pending++
    } catch (error) {
      await putRe20OfflineDraft(userId, {
        ...entry,
        updatedAt: new Date().toISOString(),
        attempts: entry.attempts + 1,
        lastError: error instanceof Error ? error.message : "Sin conexión",
      })
      result.pending++
    }
  }
  return result
}

/**
 * Una entrada sólo se elimina después de la aceptación del servidor. Los fallos
 * de red quedan en cola, sin caducidad ni límite de intentos; un rechazo
 * permanente (`retriable: false`) queda marcado y se muestra, no se reenvía.
 */
export function flushIncidentReportQueue(userId: string, sender: IncidentReportSender): Promise<IncidentQueueFlushResult> {
  const run = flushChain.then(() => flushOnce(userId, sender))
  flushChain = run.catch(() => undefined)
  return run
}

/** Descarte explícito de un reporte guardado en este equipo. */
export async function discardQueuedIncidentReport(userId: string, id: string) {
  await deleteRe20OfflineDraft(userId, id)
}

/**
 * Cierre de sesión: vacía TODO lo de Incidentes / RE-20 que quedó en este
 * equipo —los borradores por usuario (reportes por enviar y copia local de los
 * expedientes) y la cola antigua en claro—. Esa cola antigua no registra a quién
 * pertenece cada reporte: si sobreviviera al cambio de usuario, el siguiente en
 * el mismo equipo la migraría a su propio almacén.
 *
 * Intenta ambas aunque una falle y, si alguna falló, lanza el primer error para
 * que quien llama lo sepa (el cierre de sesión lo ignora: nunca se bloquea).
 * Devuelve cuántos registros eliminó.
 */
export async function purgeIncidentOfflineData(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0
  const [drafts, legacy] = await Promise.allSettled([
    purgeRe20OfflineDrafts(),
    (async () => {
      const entries = await listLegacyIncidentReports()
      if (entries.length > 0) await clearLegacyIncidentReports()
      return entries.length
    })(),
  ])
  if (drafts.status === "rejected") throw drafts.reason
  if (legacy.status === "rejected") throw legacy.reason
  return drafts.value + legacy.value
}

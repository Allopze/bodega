import { nanoid } from "@/lib/id"
import {
  deleteRe20OfflineDraft,
  getRe20OfflineDraft,
  listRe20OfflineDrafts,
  putRe20OfflineDraft,
  type OfflineDraft,
} from "@/lib/prevention/re20-offline-vault"
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

/** Migra el almacén antiguo sólo después de desbloquear el cifrado local. */
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
      throw new Error("No se pudo verificar un reporte antiguo cifrado; la cola original se conservó.")
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
    throw new Error("No se pudo verificar el reporte en la bóveda local; el formulario conserva los datos.")
  }
  return entry
}

export async function listQueuedIncidentReports(userId: string): Promise<QueueEntry[]> {
  const drafts = await listRe20OfflineDrafts<OfflineIncidentReport>(userId)
  return drafts.filter((draft): draft is QueueEntry => draft.kind === "incident_report")
}

/**
 * Una entrada sólo se elimina después de la aceptación del servidor. Los
 * rechazos y fallos de red quedan cifrados, sin caducidad ni límite de intentos.
 */
export async function flushIncidentReportQueue(
  userId: string,
  sender: (payload: OfflineIncidentReport) => Promise<{ ok: boolean; message?: string; retriable?: boolean }>,
) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { synchronized: 0, pending: (await listQueuedIncidentReports(userId)).length, rejected: 0 }
  const entries = await listQueuedIncidentReports(userId)
  const result = { synchronized: 0, pending: 0, rejected: 0 }
  for (const entry of entries) {
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

/** Descarte explícito de un reporte, siempre con bóveda desbloqueada. */
export async function discardQueuedIncidentReport(userId: string, id: string) {
  await deleteRe20OfflineDraft(userId, id)
}

/**
 * Al cerrar sesión se bloquea la bóveda (sus borradores siguen cifrados) y se
 * vacía la cola antigua en claro. Esa cola no registra a quién pertenece cada
 * reporte: si sobreviviera al cambio de usuario, el siguiente que desbloquee
 * en el mismo equipo la migraría a su propia bóveda.
 */
export async function lockAndPurgeIncidentQueues(): Promise<number> {
  const { lockRe20Vault } = await import("@/lib/prevention/re20-offline-vault")
  lockRe20Vault()
  if (typeof indexedDB === "undefined") return 0
  const legacy = await listLegacyIncidentReports()
  if (legacy.length > 0) await clearLegacyIncidentReports()
  return legacy.length
}

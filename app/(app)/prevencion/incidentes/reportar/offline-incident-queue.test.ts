// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  discardQueuedIncidentReport,
  flushIncidentReportQueue,
  listQueuedIncidentReports,
  migrateLegacyIncidentReportQueue,
  purgeIncidentOfflineData,
  queueIncidentReport,
  type OfflineIncidentReport,
} from "./offline-incident-queue"
import { listRe20OfflineDrafts, putRe20OfflineDraft } from "@/lib/prevention/re20-offline-drafts"
import { listLegacyIncidentReports } from "./offline-incident-queue-legacy"

/** Siembra la cola v2 en claro tal como la dejaba la versión anterior. */
function seedLegacyQueue(entry: { id: string; payload: unknown; queuedAt: string; attempts: number }) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("chome-prevention-offline", 2)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains("incident-reports")) database.createObjectStore("incident-reports", { keyPath: "id" })
      if (!database.objectStoreNames.contains("inspection-submissions")) database.createObjectStore("inspection-submissions", { keyPath: "id" })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction("incident-reports", "readwrite")
      transaction.objectStore("incident-reports").put(entry)
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => reject(transaction.error)
    }
  })
}

const USER_ID = "offline-queue-test-user"
const OTHER_USER_ID = "offline-queue-other-user"

const payload: OfflineIncidentReport = {
  clientSubmissionId: "offline-test-idempotent-001",
  worksiteId: "ws-1",
  companyName: "Contratista Prueba",
  eventType: "contractor_or_third_party",
  occurredAt: "2026-07-18T10:00:00.000Z",
  knownAt: "2026-07-18T10:15:00.000Z",
  location: "Patio norte",
  initialNarrative: "Evento operacional reportado durante la prueba offline.",
  actualSeverity: "none",
  potentialSeverity: "medium",
  immediateMeasures: "Área aislada",
  operationsSuspended: false,
  evacuated: false,
  isFatalOrSerious: false,
  offlineSync: true,
  people: [],
}

beforeEach(async () => {
  for (const userId of [USER_ID, OTHER_USER_ID]) {
    for (const entry of await listQueuedIncidentReports(userId)) await discardQueuedIncidentReport(userId, entry.id)
  }
  await purgeIncidentOfflineData()
})

describe("incident offline queue", () => {
  it("keeps one entry per stable client submission id and synchronizes it once", async () => {
    await queueIncidentReport(USER_ID, payload)
    await queueIncidentReport(USER_ID, payload)
    expect(await listQueuedIncidentReports(USER_ID)).toHaveLength(1)
    let calls = 0
    const result = await flushIncidentReportQueue(USER_ID, async (sent) => {
      calls++
      expect(sent.clientSubmissionId).toBe(payload.clientSubmissionId)
      return { ok: true }
    })
    expect(result).toEqual({ synchronized: 1, pending: 0, rejected: 0 })
    expect(calls).toBe(1)
    expect(await listQueuedIncidentReports(USER_ID)).toHaveLength(0)
  })

  it("preserves a rejected report for a later retry", async () => {
    await queueIncidentReport(USER_ID, payload)
    expect(await flushIncidentReportQueue(USER_ID, async () => ({ ok: false, message: "sin red" }))).toEqual({ synchronized: 0, pending: 1, rejected: 0 })
    const [entry] = await listQueuedIncidentReports(USER_ID)
    expect(entry).toMatchObject({ id: `incident-report:${payload.clientSubmissionId}`, attempts: 1, lastError: "sin red" })
  })

  it("no deja rechazado para siempre un fallo sin veredicto, pero sí un rechazo permanente", async () => {
    await queueIncidentReport(USER_ID, payload)
    let calls = 0
    const sender = async () => { calls++; return { ok: false, message: "La faena no existe", retriable: false } }

    expect(await flushIncidentReportQueue(USER_ID, sender)).toEqual({ synchronized: 0, pending: 0, rejected: 1 })
    const [entry] = await listQueuedIncidentReports(USER_ID)
    expect(entry).toMatchObject({ rejected: true, lastError: "La faena no existe", attempts: 1 })

    // Ya rechazado: no se reenvía solo ni se vuelve a contar como rechazo nuevo.
    expect(await flushIncidentReportQueue(USER_ID, sender)).toEqual({ synchronized: 0, pending: 0, rejected: 0 })
    expect(calls).toBe(1)
    expect(await listQueuedIncidentReports(USER_ID)).toHaveLength(1)
  })

  it("un fallo de red deja el reporte en cola para el próximo intento", async () => {
    await queueIncidentReport(USER_ID, payload)
    expect(await flushIncidentReportQueue(USER_ID, async () => { throw new TypeError("Failed to fetch") })).toEqual({ synchronized: 0, pending: 1, rejected: 0 })
    expect(await flushIncidentReportQueue(USER_ID, async () => ({ ok: true }))).toEqual({ synchronized: 1, pending: 0, rejected: 0 })
    expect(await listQueuedIncidentReports(USER_ID)).toHaveLength(0)
  })

  it("dos envíos simultáneos (montaje + evento online) no mandan el mismo reporte dos veces", async () => {
    await queueIncidentReport(USER_ID, payload)
    let calls = 0
    const sender = async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 10)); return { ok: true } }
    await Promise.all([flushIncidentReportQueue(USER_ID, sender), flushIncidentReportQueue(USER_ID, sender)])
    expect(calls).toBe(1)
  })

  it("sin conexión no envía ni gasta intentos", async () => {
    await queueIncidentReport(USER_ID, payload)
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    try {
      let calls = 0
      expect(await flushIncidentReportQueue(USER_ID, async () => { calls++; return { ok: true } })).toEqual({ synchronized: 0, pending: 1, rejected: 0 })
      expect(calls).toBe(0)
      expect((await listQueuedIncidentReports(USER_ID))[0]?.attempts).toBe(0)
    } finally {
      onLine.mockRestore()
    }
  })

  it("cada persona ve y envía sólo sus reportes", async () => {
    await queueIncidentReport(USER_ID, payload)
    await queueIncidentReport(OTHER_USER_ID, { ...payload, clientSubmissionId: "offline-test-other" })
    expect(await listQueuedIncidentReports(USER_ID)).toHaveLength(1)
    const sent: string[] = []
    await flushIncidentReportQueue(USER_ID, async (report) => { sent.push(report.clientSubmissionId); return { ok: true } })
    expect(sent).toEqual([payload.clientSubmissionId])
    expect(await listQueuedIncidentReports(OTHER_USER_ID)).toHaveLength(1)
  })

  it("no expulsa borradores cuando la cola crece: no hay tope ni caducidad", async () => {
    for (let i = 0; i < 27; i++) {
      await queueIncidentReport(USER_ID, { ...payload, clientSubmissionId: `offline-test-${i}` })
    }
    expect(await listQueuedIncidentReports(USER_ID)).toHaveLength(27)
  })

  it("migra la cola antigua en claro al almacén de la persona y la vacía", async () => {
    await seedLegacyQueue({ id: "legacy-1", payload, queuedAt: "2026-07-18T10:20:00.000Z", attempts: 3 })

    expect(await migrateLegacyIncidentReportQueue(USER_ID)).toBe(1)

    expect(await listLegacyIncidentReports()).toHaveLength(0)
    const [entry] = await listQueuedIncidentReports(USER_ID)
    expect(entry).toMatchObject({ id: `incident-report:${payload.clientSubmissionId}`, attempts: 3, createdAt: "2026-07-18T10:20:00.000Z" })
    expect(entry?.payload.offlineSync).toBe(true)
    expect(await migrateLegacyIncidentReportQueue(USER_ID)).toBe(0)
  })

  it("al cerrar sesión se purga TODO: la cola antigua en claro y los borradores de cualquier persona", async () => {
    await seedLegacyQueue({ id: "legacy-1", payload, queuedAt: "2026-07-18T10:20:00.000Z", attempts: 0 })
    await queueIncidentReport(USER_ID, payload)
    await queueIncidentReport(OTHER_USER_ID, { ...payload, clientSubmissionId: "offline-test-other" })
    await putRe20OfflineDraft(USER_ID, { id: "incident-workspace:inc-1", kind: "incident_workspace", payload: { incidentId: "inc-1" }, attempts: 0 })

    expect(await purgeIncidentOfflineData()).toBe(4)

    expect(await listLegacyIncidentReports()).toHaveLength(0)
    expect(await listRe20OfflineDrafts(USER_ID)).toEqual([])
    expect(await listRe20OfflineDrafts(OTHER_USER_ID)).toEqual([])
    expect(await purgeIncidentOfflineData()).toBe(0)
  })
})

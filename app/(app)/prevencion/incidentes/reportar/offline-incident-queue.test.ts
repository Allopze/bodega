// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"
import {
  flushIncidentReportQueue,
  listQueuedIncidentReports,
  queueIncidentReport,
  type OfflineIncidentReport,
} from "./offline-incident-queue"

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
  const entries = await listQueuedIncidentReports()
  if (entries.length > 0) {
    await flushIncidentReportQueue(async () => ({ ok: true }))
  }
})

describe("incident offline queue", () => {
  it("keeps one entry per stable client submission id and synchronizes it once", async () => {
    await queueIncidentReport(payload)
    await queueIncidentReport(payload)
    expect(await listQueuedIncidentReports()).toHaveLength(1)
    let calls = 0
    const result = await flushIncidentReportQueue(async (sent) => {
      calls++
      expect(sent.clientSubmissionId).toBe(payload.clientSubmissionId)
      return { ok: true }
    })
    expect(result).toEqual({ synchronized: 1, pending: 0 })
    expect(calls).toBe(1)
    expect(await listQueuedIncidentReports()).toHaveLength(0)
  })

  it("preserves a rejected report for a later retry", async () => {
    await queueIncidentReport(payload)
    expect(await flushIncidentReportQueue(async () => ({ ok: false, message: "sin red" }))).toEqual({ synchronized: 0, pending: 1 })
    const [entry] = await listQueuedIncidentReports()
    expect(entry).toMatchObject({ id: payload.clientSubmissionId, attempts: 1, lastError: "sin red" })
  })
})

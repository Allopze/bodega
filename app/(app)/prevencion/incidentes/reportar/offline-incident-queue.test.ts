// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"
import {
  discardQueuedIncidentReport,
  flushIncidentReportQueue,
  listQueuedIncidentReports,
  lockAndPurgeIncidentQueues,
  queueIncidentReport,
  type OfflineIncidentReport,
} from "./offline-incident-queue"
import { lockRe20Vault, unlockRe20Vault } from "@/lib/prevention/re20-offline-vault"
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
const PASSPHRASE = "bodega-test-passphrase-2026"

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
  await unlockRe20Vault(USER_ID, PASSPHRASE)
  for (const entry of await listQueuedIncidentReports(USER_ID)) {
    await discardQueuedIncidentReport(USER_ID, entry.id)
  }
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

  it("keeps the draft after locking the key and reopening the browser session", async () => {
    await queueIncidentReport(USER_ID, payload)
    lockRe20Vault(USER_ID)
    await expect(listQueuedIncidentReports(USER_ID)).rejects.toThrow(/desbloquea/i)
    await unlockRe20Vault(USER_ID, PASSPHRASE)
    const [entry] = await listQueuedIncidentReports(USER_ID)
    expect(entry?.payload.clientSubmissionId).toBe(payload.clientSubmissionId)
  })

  it("does not evict drafts as the queue grows past the old plaintext limit", async () => {
    for (let i = 0; i < 27; i++) {
      await queueIncidentReport(USER_ID, { ...payload, clientSubmissionId: `offline-test-${i}` })
    }
    expect(await listQueuedIncidentReports(USER_ID)).toHaveLength(27)
  })

  it("purges the plaintext legacy queue on sign-out so the next user cannot adopt it", async () => {
    await seedLegacyQueue({ id: "legacy-1", payload, queuedAt: "2026-07-18T10:20:00.000Z", attempts: 0 })
    await queueIncidentReport(USER_ID, payload)

    expect(await lockAndPurgeIncidentQueues()).toBe(1)

    expect(await listLegacyIncidentReports()).toHaveLength(0)
    await unlockRe20Vault(USER_ID, PASSPHRASE)
    expect(await listQueuedIncidentReports(USER_ID)).toHaveLength(1)
  })
})

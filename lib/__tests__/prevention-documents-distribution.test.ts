import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  globalRows: [] as Array<Array<Record<string, unknown>>>,
  globalSelectIndex: 0,
  txRows: [] as Array<Array<Record<string, unknown>>>,
  txSelectIndex: 0,
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/db", () => {
  const tx = {
    select: vi.fn(() => {
      const index = state.txSelectIndex
      state.txSelectIndex += 1
      const rows = state.txRows[index] ?? []
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => index === 1
            ? { for: vi.fn(async () => rows) }
            : Promise.resolve(rows)),
        })),
      }
    }),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        state.inserts.push(values)
        if (values.action) return Promise.resolve()
        return { returning: vi.fn(async () => [{ ...values }]) }
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        state.updates.push(values)
        return { where: vi.fn(async () => undefined) }
      }),
    })),
  }

  return {
    db: {
      select: vi.fn(() => {
        const index = state.globalSelectIndex
        state.globalSelectIndex += 1
        const rows = state.globalRows[index] ?? []
        return { from: vi.fn(() => ({ where: vi.fn(async () => rows) })) }
      }),
      transaction: vi.fn(async (operation: (transaction: typeof tx) => unknown) => operation(tx)),
    },
  }
})

import {
  acknowledgeDocumentVersion,
  assignDocumentVersionRecipients,
  buildDocumentAcknowledgmentSignature,
} from "@/lib/services/prevention-documents/distribution"

const context = {
  ctx: { userId: "user-1", ip: "127.0.0.1", userAgent: "Vitest" },
  scope: { mode: "some" as const, ids: ["ws-1"] },
  permissions: ["prevention:docs:ack", "prevention:docs:distribute"],
}

function queuePublishedContext(confidentiality = "publico_interno") {
  state.globalRows.push(
    [{
      id: "sdv-1",
      documentId: "sdoc-1",
      status: "vigente",
      checksum: "checksum-v1",
    }],
    [{
      id: "sdoc-1",
      status: "vigente",
      currentVersionId: "sdv-1",
      worksiteId: "ws-1",
      confidentiality,
      requiresAcknowledgment: true,
    }],
  )
}

describe("document distribution and acknowledgments", () => {
  beforeEach(() => {
    state.globalRows.length = 0
    state.globalSelectIndex = 0
    state.txRows.length = 0
    state.txSelectIndex = 0
    state.inserts.length = 0
    state.updates.length = 0
  })

  it("binds an acknowledgment signature to version, checksum, user, time and method", () => {
    const base = {
      versionId: "sdv-1",
      checksum: "checksum-v1",
      userId: "user-1",
      acknowledgedAt: "2026-07-18T10:00:00.000Z",
      method: "digital",
    }
    const signature = buildDocumentAcknowledgmentSignature(base)

    expect(signature).toMatch(/^[a-f0-9]{64}$/)
    expect(buildDocumentAcknowledgmentSignature({ ...base, versionId: "sdv-2" })).not.toBe(signature)
    expect(buildDocumentAcknowledgmentSignature({ ...base, checksum: "checksum-v2" })).not.toBe(signature)
    expect(buildDocumentAcknowledgmentSignature({ ...base, userId: "user-2" })).not.toBe(signature)
  })

  it("rejects acknowledgment when the current user has no nominative target", async () => {
    queuePublishedContext()
    state.txRows.push([{ workerId: null, isActive: true }], [])

    await expect(acknowledgeDocumentVersion({ ...context, versionId: "sdv-1" }))
      .rejects.toThrow(/asignación nominativa/i)
    expect(state.inserts).toHaveLength(0)
  })

  it("records an exact-version acknowledgment and closes only that target", async () => {
    queuePublishedContext()
    state.txRows.push(
      [{ workerId: "worker-1", isActive: true }],
      [{ id: "target-1", versionId: "sdv-1", status: "pendiente" }],
      [],
    )

    const acknowledgment = await acknowledgeDocumentVersion({ ...context, versionId: "sdv-1" })

    expect(acknowledgment).toEqual(expect.objectContaining({
      versionId: "sdv-1",
      userId: "user-1",
      method: "digital",
      signature: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(state.updates).toContainEqual(expect.objectContaining({ status: "acusado" }))
    expect(state.inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({ versionId: "sdv-1", userId: "user-1" }),
      expect.objectContaining({
        action: "ack",
        metadata: expect.objectContaining({ checksum: "checksum-v1", targetId: "target-1" }),
      }),
    ]))
  })

  it("blocks general bulk distribution for a sensitive document", async () => {
    queuePublishedContext("sensible")

    await expect(assignDocumentVersionRecipients({
      ...context,
      permissions: ["prevention:docs:distribute", "prevention:docs:manage_sensitive"],
      versionId: "sdv-1",
      userIds: ["user-1", "user-2"],
      assignmentReason: "Aplicable al equipo",
    })).rejects.toThrow(/nominativa individual/i)
    expect(state.inserts).toHaveLength(0)
  })
})

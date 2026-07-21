import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  selectRows: [] as Array<Array<Record<string, unknown>>>,
  selectIndex: 0,
  updateRows: [] as Array<Array<Record<string, unknown>>>,
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/db", () => {
  const tx = {
    select: vi.fn(() => {
      const index = state.selectIndex
      state.selectIndex += 1
      const rows = state.selectRows[index] ?? []
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => index === 0
            ? Promise.resolve(rows)
            : { for: vi.fn(async () => rows) }),
        })),
      }
    }),
    update: vi.fn(() => ({
      set: vi.fn((patch: Record<string, unknown>) => {
        state.updates.push(patch)
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => state.updateRows.shift() ?? []),
          })),
        }
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        state.inserts.push(values)
      }),
    })),
  }

  return {
    db: {
      transaction: vi.fn(async (operation: (transaction: typeof tx) => unknown) => operation(tx)),
    },
  }
})

import {
  approveDocumentVersion,
  observeDocumentVersion,
  publishDocumentVersion,
  submitDocumentVersionForReview,
} from "@/lib/services/prevention-documents/workflow"

const baseArgs = {
  versionId: "sdv-new",
  ctx: { userId: "approver-1", userEmail: "approver@example.test" },
  scope: { mode: "some" as const, ids: ["ws-1"] },
  permissions: ["prevention:docs:approve", "prevention:docs:manage_restricted"],
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sdoc-1",
    status: "vigente",
    currentVersionId: "sdv-current",
    worksiteId: "ws-1",
    confidentiality: "publico_interno",
    effectiveFrom: null,
    ...overrides,
  }
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sdv-new",
    documentId: "sdoc-1",
    status: "en_revision",
    uploadedBy: "uploader-1",
    reviewedBy: "reviewer-1",
    approvedBy: null,
    approvedAt: null,
    checksum: "sha256-new",
    effectiveFrom: null,
    supersedesId: null,
    ...overrides,
  }
}

function queueContext(doc: Record<string, unknown>, version: Record<string, unknown>) {
  state.selectRows.push(
    [{ documentId: "sdoc-1" }],
    [doc],
    [version],
  )
}

describe("document version workflow", () => {
  beforeEach(() => {
    state.selectRows.length = 0
    state.selectIndex = 0
    state.updateRows.length = 0
    state.updates.length = 0
    state.inserts.length = 0
  })

  it("requires evidence when a reviewer observes a version", async () => {
    await expect(observeDocumentVersion({ ...baseArgs, comment: "" }))
      .rejects.toThrow(/comentario/i)
    expect(state.selectIndex).toBe(0)
  })

  it("prevents the uploader from approving their own version", async () => {
    queueContext(documentRow(), versionRow({ uploadedBy: "approver-1" }))

    await expect(approveDocumentVersion(baseArgs)).rejects.toThrow(/cargó.*no puede aprobar/i)
    expect(state.updates).toHaveLength(0)
  })

  it("requires a recorded review before approval", async () => {
    queueContext(documentRow(), versionRow({ reviewedBy: null }))

    await expect(approveDocumentVersion(baseArgs)).rejects.toThrow(/revisión registrada/i)
    expect(state.updates).toHaveLength(0)
  })

  it("keeps the published document status unchanged while a draft enters review", async () => {
    queueContext(documentRow(), versionRow({ status: "borrador" }))
    state.updateRows.push([versionRow({ status: "en_revision", reviewedBy: null })])

    await submitDocumentVersionForReview({
      ...baseArgs,
      ctx: { userId: "uploader-1" },
      permissions: ["prevention:docs:submit_review"],
    })

    expect(state.updates).toHaveLength(1)
    expect(state.updates[0]).toEqual(expect.objectContaining({ status: "en_revision" }))
    expect(state.inserts[0]).toEqual(expect.objectContaining({
      fromStatus: "borrador",
      toStatus: "en_revision",
    }))
  })

  it("publishes and replaces exactly the previous current version in one transaction", async () => {
    const approved = versionRow({
      status: "aprobado",
      approvedBy: "approver-1",
      approvedAt: "2026-07-18T10:00:00.000Z",
    })
    queueContext(documentRow(), approved)
    state.selectRows.push([versionRow({ id: "sdv-current", status: "vigente" })])
    state.updateRows.push([{ ...approved, status: "vigente", supersedesId: "sdv-current" }])

    const published = await publishDocumentVersion({ ...baseArgs, comment: "Publicación controlada" })

    expect(published).toEqual(expect.objectContaining({ status: "vigente", supersedesId: "sdv-current" }))
    expect(state.updates).toHaveLength(3)
    expect(state.updates[0]).toEqual(expect.objectContaining({ status: "reemplazado" }))
    expect(state.updates[1]).toEqual(expect.objectContaining({ status: "vigente", supersedesId: "sdv-current" }))
    expect(state.updates[2]).toEqual(expect.objectContaining({
      status: "vigente",
      currentVersionId: "sdv-new",
      checksum: "sha256-new",
    }))
    expect(state.inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "replace", versionId: "sdv-current" }),
      expect.objectContaining({ action: "status_change", versionId: "sdv-new", toStatus: "vigente" }),
    ]))
  })

  it("does not publish an approved version before its effective date", async () => {
    queueContext(documentRow(), versionRow({
      status: "aprobado",
      approvedBy: "approver-1",
      approvedAt: "2026-07-18T10:00:00.000Z",
      effectiveFrom: "2999-01-01",
    }))

    await expect(publishDocumentVersion(baseArgs)).rejects.toThrow(/antes del 2999-01-01/i)
    expect(state.updates).toHaveLength(0)
  })
})

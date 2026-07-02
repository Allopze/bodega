import { beforeEach, describe, expect, it, vi } from "vitest"

const mockDoc = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
const mockUpdated = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
const mockSelectWhere = vi.hoisted(() => vi.fn())
const mockUpdateSet = vi.hoisted(() => vi.fn())
const mockInsertOnConflictDoNothing = vi.hoisted(() => vi.fn())
const mockInsertValues = vi.hoisted(() => vi.fn(() => ({
  onConflictDoNothing: mockInsertOnConflictDoNothing,
})))

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: mockSelectWhere,
      })),
    })),
    update: vi.fn(() => ({
      set: mockUpdateSet,
    })),
    insert: vi.fn(() => ({
      values: mockInsertValues,
    })),
  },
}))

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
  recordStatusChange: vi.fn(),
}))

import { linkDocumentToEntity, updateDocumentMetadata } from "@/lib/services/prevention-documents-library"

const ctx = {
  userId: "user-1",
  userEmail: "prev@example.test",
  ip: "127.0.0.1",
}

describe("prevention documents library service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelectWhere.mockReset()
    mockUpdateSet.mockReset()
    mockInsertValues.mockReset()
    mockInsertOnConflictDoNothing.mockReset()
    mockDoc.current = {
      id: "sdoc-1",
      title: "Procedimiento crítico",
      status: "borrador",
      worksiteId: "ws-1",
      confidentiality: "sensible",
    }
    mockUpdated.current = { ...mockDoc.current, updatedAt: "2026-07-01T00:00:00.000Z" }
    mockSelectWhere.mockResolvedValue([mockDoc.current])
    mockUpdateSet.mockReturnValue({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([mockUpdated.current]),
      })),
    })
    mockInsertValues.mockReturnValue({ onConflictDoNothing: mockInsertOnConflictDoNothing })
    mockInsertOnConflictDoNothing.mockResolvedValue(undefined)
  })

  it("denies moving metadata to a worksite outside the caller's scope", async () => {
    await expect(updateDocumentMetadata({
      input: {
        id: "sdoc-1",
        worksiteId: "ws-2",
      },
      ctx,
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: ["prevention:docs:manage_sensitive"],
    })).rejects.toThrow(/sin acceso|requiere alcance global/i)
  })

  it("requires the confidentiality permission to edit an already sensitive document", async () => {
    await expect(updateDocumentMetadata({
      input: {
        id: "sdoc-1",
        title: "Procedimiento crítico actualizado",
      },
      ctx,
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: [],
    })).rejects.toThrow(/documentos sensibles/i)
  })

  it("denies linking a document to a missing entity", async () => {
    mockDoc.current = {
      id: "sdoc-1",
      title: "Procedimiento",
      status: "borrador",
      worksiteId: "ws-1",
      confidentiality: "publico_interno",
    }
    mockSelectWhere
      .mockResolvedValueOnce([mockDoc.current])
      .mockResolvedValueOnce([])

    await expect(linkDocumentToEntity({
      input: {
        documentId: "sdoc-1",
        entityType: "worker",
        entityId: "worker-missing",
      },
      ctx,
      scope: { mode: "some", ids: ["ws-1"] },
    })).rejects.toThrow(/entidad vinculada no encontrada/i)
  })

  it("denies linking a document to an entity outside the caller's worksite scope", async () => {
    mockDoc.current = {
      id: "sdoc-1",
      title: "Procedimiento",
      status: "borrador",
      worksiteId: "ws-1",
      confidentiality: "publico_interno",
    }
    mockSelectWhere
      .mockResolvedValueOnce([mockDoc.current])
      .mockResolvedValueOnce([{ worksiteId: "ws-2" }])

    await expect(linkDocumentToEntity({
      input: {
        documentId: "sdoc-1",
        entityType: "worker",
        entityId: "worker-2",
      },
      ctx,
      scope: { mode: "some", ids: ["ws-1"] },
    })).rejects.toThrow(/sin acceso/i)
  })
})

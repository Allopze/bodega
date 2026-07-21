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

import { recordStatusChange } from "@/lib/audit"
import { restoreDocument, updateDocumentMetadata } from "@/lib/services/prevention-documents-library"
import { getDashboardCounters, getDocumentBundle, searchDocuments } from "@/lib/services/prevention-documents/search"
import { allowedDocumentConfidentialities, assertGeneralLibraryContentAllowed } from "@/lib/services/prevention-documents/utils"

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

  it("restores an archived document as draft and records the status change", async () => {
    mockDoc.current = {
      id: "sdoc-1",
      title: "Procedimiento archivado",
      status: "archivado",
      worksiteId: "ws-1",
      confidentiality: "publico_interno",
    }
    mockUpdated.current = { ...mockDoc.current, status: "borrador" }
    mockSelectWhere.mockResolvedValue([mockDoc.current])

    await restoreDocument({
      input: { documentId: "sdoc-1", comment: "Restaurar" },
      ctx,
      scope: { mode: "some", ids: ["ws-1"] },
    })

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "borrador" }))
    expect(recordStatusChange).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "sst_document",
      entityId: "sdoc-1",
      fromStatus: "archivado",
      toStatus: "borrador",
    }))
  })
})

describe("prevention documents library scope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelectWhere.mockReset()
  })

  it("uses a public-only default and adds restricted/sensitive access explicitly", () => {
    expect(allowedDocumentConfidentialities([])).toEqual(["publico_interno"])
    expect(allowedDocumentConfidentialities(["prevention:docs:manage_restricted"]))
      .toEqual(["publico_interno", "restringido"])
    expect(allowedDocumentConfidentialities(["prevention:docs:manage_sensitive"]))
      .toEqual(["publico_interno", "sensible"])
  })

  it("rejects clinical and reserved classifications in the general library", () => {
    expect(() => assertGeneralLibraryContentAllowed({ dataClass: "clinical" })).toThrow(/dominio seguro/i)
    expect(() => assertGeneralLibraryContentAllowed({ dataClass: "reserved_investigation" })).toThrow(/dominio seguro/i)
    expect(() => assertGeneralLibraryContentAllowed({ dataClass: "sensitive_preventive" })).not.toThrow()
  })

  it("returns no documents or counters without worksite scope", async () => {
    const noScope = { mode: "none" as const, ids: [] as [] }

    await expect(searchDocuments({ page: 1, pageSize: 50 }, noScope)).resolves.toEqual({ rows: [], total: 0 })
    await expect(getDashboardCounters(noScope)).resolves.toEqual({
      total: 0,
      byStatus: { borrador: 0, en_revision: 0, observado: 0, aprobado: 0, vigente: 0, vencido: 0, reemplazado: 0, archivado: 0 },
      expiringSoon: { within7: 0, within15: 0, within30: 0 },
      pendingReview: 0,
      observed: 0,
      ackPending: 0,
    })
  })

  it("returns null to the UI for a document from a foreign worksite", async () => {
    mockSelectWhere.mockResolvedValue([{
      id: "sdoc-foreign",
      worksiteId: "ws-2",
      confidentiality: "publico_interno",
    }])

    await expect(getDocumentBundle(
      "sdoc-foreign",
      { mode: "some", ids: ["ws-1"] },
      ["prevention:docs:view"],
    )).resolves.toBeNull()
  })
})

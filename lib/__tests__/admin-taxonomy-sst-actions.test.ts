/**
 * Unit tests for the SST document taxonomy admin actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockUpsertCategory = vi.hoisted(() => vi.fn())
const mockUpsertType = vi.hoisted(() => vi.fn())
const mockSetCategoryActive = vi.hoisted(() => vi.fn())
const mockSetTypeActive = vi.hoisted(() => vi.fn())
const mockSeedDefault = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockReplaceBindings = vi.hoisted(() => vi.fn())
const mockTx = vi.hoisted(() => ({ kind: "test-transaction" }))

vi.mock("@/db", () => ({
  db: { transaction: (callback: (tx: typeof mockTx) => unknown) => callback(mockTx) },
}))

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}))
vi.mock("@/lib/services/prevention-documents/taxonomy", () => ({
  upsertDocumentCategory: mockUpsertCategory,
  upsertDocumentType:     mockUpsertType,
  setDocumentCategoryActive: mockSetCategoryActive,
  setDocumentTypeActive: mockSetTypeActive,
  seedDefaultCategories: mockSeedDefault,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/services/pdtp/accreditation-bindings", () => ({
  replacePdtpAccreditationBindings: mockReplaceBindings,
}))

import {
  saveDocumentCategoryAction,
  saveDocumentTypeAction,
  setDocumentCategoryStatusAction,
  setDocumentTypeStatusAction,
  seedDefaultDocumentCategoriesAction,
} from "@/app/(app)/admin/taxonomia-sst/actions"
import type { ActionState } from "@/lib/validation/masters"

const prevState: ActionState = { ok: false, message: "" }

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "admin@test.cl",
      name: "Admin",
      roles: ["prevencionista"],
      permissions: ["admin:document_taxonomy"],
      worksiteIds: [],
      primaryWorksiteId: "",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

describe("saveDocumentCategoryAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("requires permission", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const fd = new FormData(); fd.set("slug", "x"); fd.set("name", "X")
    const res = await saveDocumentCategoryAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("rejects missing slug", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = new FormData(); fd.set("name", "X")
    const res = await saveDocumentCategoryAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.slug).toBeDefined()
  })

  it("rejects missing name", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = new FormData(); fd.set("slug", "x")
    const res = await saveDocumentCategoryAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.name).toBeDefined()
  })

  it("upserts, audits, and revalidates", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockUpsertCategory.mockResolvedValueOnce({ slug: "x", name: "X", isActive: true, sortOrder: 0 })

    const fd = new FormData(); fd.set("slug", "x"); fd.set("name", "X"); fd.set("isActive", "on")
    const res = await saveDocumentCategoryAction(prevState, fd)

    expect(res.ok).toBe(true)
    expect(mockUpsertCategory).toHaveBeenCalledWith(expect.objectContaining({ slug: "x", name: "X" }))
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "update", entityType: "sst_document_category", entityId: "x",
    }))
  })
})

describe("saveDocumentTypeAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("requires category slug, code, and name", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = new FormData(); fd.set("code", "C"); fd.set("name", "N")
    const res = await saveDocumentTypeAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.categorySlug).toBeDefined()
  })

  it("upserts and audits", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockUpsertType.mockResolvedValueOnce({
      id: "t-1", categorySlug: "epp", code: "C", name: "N", isActive: true,
    })
    const fd = new FormData()
    fd.set("categorySlug", "epp")
    fd.set("code", "C")
    fd.set("name", "N")
    fd.set("requiresApproval", "on")
    const res = await saveDocumentTypeAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockUpsertType).toHaveBeenCalled()
    expect(mockReplaceBindings).toHaveBeenCalledTimes(2)
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "sst_document_type",
    }))
  })

  it("surfaces a missing category as an error message", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockUpsertType.mockRejectedValueOnce(new Error("La categoría indicada no existe"))
    const fd = new FormData()
    fd.set("categorySlug", "categoria_que_no_existe")
    fd.set("code", "C")
    fd.set("name", "N")
    const res = await saveDocumentTypeAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("La categoría indicada no existe")
  })
})

describe("setDocumentCategoryStatusAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("deactivates", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockSetCategoryActive.mockResolvedValueOnce({ row: { slug: "x", name: "X", isActive: false }, previousIsActive: true })
    const fd = new FormData(); fd.set("slug", "x"); fd.set("activate", "false")
    const res = await setDocumentCategoryStatusAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      oldState: { isActive: true },
      newState: { isActive: false },
    }))
  })

  it("reactivates", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockSetCategoryActive.mockResolvedValueOnce({ row: { slug: "x", name: "X", isActive: true }, previousIsActive: false })
    const fd = new FormData(); fd.set("slug", "x"); fd.set("activate", "true")
    const res = await setDocumentCategoryStatusAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      oldState: { isActive: false },
      newState: { isActive: true },
    }))
  })
})

describe("setDocumentTypeStatusAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("toggles by id", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockSetTypeActive.mockResolvedValueOnce({ row: { id: "t-1", name: "X", isActive: false }, previousIsActive: true })
    const fd = new FormData(); fd.set("id", "t-1"); fd.set("activate", "false")
    const res = await setDocumentTypeStatusAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "sst_document_type",
      entityId: "t-1",
      oldState: { isActive: true },
      newState: { isActive: false },
    }))
  })
})

describe("seedDefaultDocumentCategoriesAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("seeds and audits as sst_document_taxonomy", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockSeedDefault.mockResolvedValueOnce(undefined)
    const res = await seedDefaultDocumentCategoriesAction(prevState)
    expect(res.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "sst_document_taxonomy",
      entityId: "seed",
    }))
  })
})

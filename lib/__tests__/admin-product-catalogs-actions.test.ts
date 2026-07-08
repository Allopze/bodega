/**
 * Unit tests for product auxiliary catalog actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockFindFirstUnit = vi.hoisted(() => vi.fn())
const mockFindFirstAttr = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}))
vi.mock("@/db", () => ({
  db: {
    query: {
      productUnits: { findFirst: mockFindFirstUnit },
      productAttributeTemplates: { findFirst: mockFindFirstAttr },
    },
    insert: mockInsert,
    update: mockUpdate,
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  saveProductUnitAction,
  setProductUnitStatusAction,
  saveAttributeTemplateAction,
  setAttributeTemplateStatusAction,
} from "@/app/(app)/admin/catalogos-productos/actions"
import type { ActionState } from "@/lib/validation/masters"

const prevState: ActionState = { ok: false, message: "" }

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "admin@test.cl",
      name: "Admin",
      roles: ["administrador"],
      permissions: ["admin:product_catalogs"],
      worksiteIds: [],
      primaryWorksiteId: "",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

function _setupInsertMock() {
  const ocFn = vi.fn().mockResolvedValue(undefined)
  mockInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({ onConflictDoUpdate: ocFn }),
  })
}

describe("saveProductUnitAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("requires admin:product_catalogs", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const fd = new FormData(); fd.set("code", "kg"); fd.set("label", "Kilogramo")
    const res = await saveProductUnitAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("rejects an existing duplicate code from a different id", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstUnit.mockResolvedValueOnce({ id: "unit-existing", code: "kg", label: "Kilogramo" })
    const fd = new FormData(); fd.set("code", "kg"); fd.set("label", "Kilogramo")
    const res = await saveProductUnitAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.code).toBeDefined()
  })

  it("creates the unit and audits it", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstUnit.mockResolvedValueOnce(null)
    mockInsert.mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) })

    const fd = new FormData(); fd.set("code", "kg"); fd.set("label", "Kilogramo"); fd.set("isActive", "on")
    const res = await saveProductUnitAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action:    "update",
      entityType: "product_unit",
    }))
  })
})

describe("setProductUnitStatusAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("deactivates a unit", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstUnit.mockResolvedValueOnce({ id: "unit-1", code: "kg", isActive: true })
    mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })

    const fd = new FormData(); fd.set("id", "unit-1"); fd.set("activate", "false")
    const res = await setProductUnitStatusAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      newState: { isActive: false },
    }))
  })
})

describe("saveAttributeTemplateAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("rejects a select without options", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = new FormData(); fd.set("name", "Talla"); fd.set("type", "select")
    const res = await saveAttributeTemplateAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.optionsText ?? res.message).toBeDefined()
  })

  it("saves a number attribute without options", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockInsert.mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) })

    const fd = new FormData()
    fd.set("name", "Longitud")
    fd.set("type", "number")
    fd.set("isRequired", "on")
    const res = await saveAttributeTemplateAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "product_attribute_template",
      newState: expect.objectContaining({ type: "number" }),
    }))
  })

  it("normalizes select options to a JSON array string", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockInsert.mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) })

    const fd = new FormData()
    fd.set("name", "Talla")
    fd.set("type", "select")
    fd.set("optionsText", "S\nM\nL\n  XL\n\n ")
    const res = await saveAttributeTemplateAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockInsert).toHaveBeenCalled()
  })
})

describe("setAttributeTemplateStatusAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("toggles an attribute template", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstAttr.mockResolvedValueOnce({ id: "attr-1", name: "Color", isActive: false })
    mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })

    const fd = new FormData(); fd.set("id", "attr-1"); fd.set("activate", "true")
    const res = await setAttributeTemplateStatusAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      newState: { isActive: true },
    }))
  })
})

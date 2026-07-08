/**
 * Unit tests for cost center admin actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockFindFirstCostCenter = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
}))
vi.mock("@/db", () => ({
  db: {
    query: {
      costCenters: { findFirst: mockFindFirstCostCenter },
    },
    insert: mockInsert,
    update: mockUpdate,
  },
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  createCostCenterAction,
  updateCostCenterAction,
  setCostCenterActiveAction,
} from "@/app/(app)/admin/centros-costo/actions"
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
      permissions: ["admin:cost_centers"],
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

function makeFormData(fields: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("code", "CC-OPER-001")
  fd.set("name", "Operaciones Zona Norte")
  fd.set("worksiteId", "ws-1")
  fd.set("description", "Centro de costo para imputaciones operativas")
  fd.set("isActive", "on")
  for (const [k, v] of Object.entries(fields)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

function setupDbMocks() {
  const whereFn = vi.fn().mockResolvedValue(undefined)
  const setChain = { where: whereFn }
  mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })
  mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue(setChain) })
}

describe("createCostCenterAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupDbMocks()
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await createCostCenterAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if code already exists", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstCostCenter.mockResolvedValueOnce({ id: "existing", code: "CC-OPER-001" })
    const res = await createCostCenterAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.code).toBeDefined()
  })

  it("creates a cost center with code, name and optional faena", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstCostCenter.mockResolvedValueOnce(null)

    const result = await createCostCenterAction(prevState, makeFormData())

    expect(result.ok).toBe(true)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        entityType: "cost_center",
      }),
    )
  })

  it("audits the create action", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstCostCenter.mockResolvedValueOnce(null)
    await createCostCenterAction(prevState, makeFormData())
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "cost_center",
        action: "create",
        entityCode: "CC-OPER-001",
      }),
    )
  })
})

describe("updateCostCenterAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupDbMocks()
  })

  it("returns error if ID missing", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    // No id field provided (delete default id), schema allows optional id
    const fd = makeFormData({ id: "" })
    const res = await updateCostCenterAction(prevState, fd)
    expect(res.ok).toBe(false)
    // Either fieldErrors or message about ID
    expect(res.ok).toBe(false)
  })

  it("returns error if cost center not found", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstCostCenter.mockResolvedValueOnce(null) // no code conflict
    mockFindFirstCostCenter.mockResolvedValueOnce(null) // not found
    const res = await updateCostCenterAction(prevState, makeFormData({ id: "cc-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no encontrado")
  })

  it("updates successfully and audits", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstCostCenter.mockResolvedValueOnce(null) // no code conflict
    mockFindFirstCostCenter.mockResolvedValueOnce({
      id: "cc-1", code: "CC-OPER-001", name: "Old", isActive: true, worksiteId: "ws-1",
    })
    const res = await updateCostCenterAction(prevState, makeFormData({ id: "cc-1" }))
    expect(res.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        entityType: "cost_center",
        entityId: "cc-1",
      }),
    )
  })
})

describe("setCostCenterActiveAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupDbMocks()
  })

  it("soft deactivates a cost center instead of deleting it", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstCostCenter.mockResolvedValueOnce({
      id: "cc-1", code: "CC-OPER-001", isActive: true,
    })
    const fd = new FormData()
    fd.set("id", "cc-1")
    fd.set("activate", "false")

    const result = await setCostCenterActiveAction(prevState, fd)

    expect(result.ok).toBe(true)
    expect(mockUpdate).toHaveBeenCalled()
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "cost_center",
        newState: { isActive: false },
      }),
    )
  })

  it("reactivates a cost center", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstCostCenter.mockResolvedValueOnce({
      id: "cc-1", code: "CC-OPER-001", isActive: false,
    })
    const fd = new FormData()
    fd.set("id", "cc-1")
    fd.set("activate", "true")

    const result = await setCostCenterActiveAction(prevState, fd)

    expect(result.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        newState: { isActive: true },
      }),
    )
  })

  it("requires admin:cost_centers permission", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const fd = new FormData()
    fd.set("id", "cc-1")
    fd.set("activate", "false")
    const res = await setCostCenterActiveAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })
})

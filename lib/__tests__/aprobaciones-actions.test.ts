/**
 * Unit tests for approval actions (aprobaciones/actions.ts).
 *
 * Covers:
 *  1. Permission denied for all actions
 *  2. Missing itemId
 *  3. Item not found
 *  4. Scope denied
 *  5. Missing reason for reject/return
 *  6. Happy path for approve, reject, return
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockCanAccessWorksite = vi.hoisted(() => vi.fn(() => true))
const mockApproveItem = vi.hoisted(() => vi.fn())
const mockRejectItem = vi.hoisted(() => vi.fn())
const mockReturnItem = vi.hoisted(() => vi.fn())
const mockFindFirstItem = vi.hoisted(() => vi.fn())
const mockNotifyAfterCommit = vi.hoisted(() => vi.fn((fn: () => Promise<unknown>) => fn()))
const mockNotifySafe = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  canAccessWorksite: mockCanAccessWorksite,
}))
vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseRequestItems: { findFirst: mockFindFirstItem },
    },
  },
}))
vi.mock("@/lib/services/item-state", () => ({
  approveItem: mockApproveItem,
  rejectItem: mockRejectItem,
  returnItem: mockReturnItem,
}))
vi.mock("@/lib/services/notifications", () => ({
  notifySafe: mockNotifySafe,
  notifyAfterCommit: mockNotifyAfterCommit,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { approveItemAction, rejectItemAction, returnItemAction } from "@/app/(app)/aprobaciones/actions"
import type { ActionState } from "@/lib/validation/operations"

const prevState: ActionState = { ok: false, message: "" }

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "admin@test.cl",
      name: "Admin",
      roles: ["administrador"],
      permissions: ["approvals:approve"],
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: "#000",
      isActive: true,
      ...overrides,
    },
  }
}

function makeItemBefore() {
  return {
    id: "item-1",
    status: "requested",
    request: { id: "req-1", code: "SOL-001", requesterId: "user-2", worksiteId: "ws-1" },
  }
}

function makeFormData(fields: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("itemId", "item-1")
  for (const [k, v] of Object.entries(fields)) {
    fd.set(k, v)
  }
  return fd
}

describe("approveItemAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if itemId missing", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = new FormData()
    const res = await approveItemAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no especificado")
  })

  it("returns error if item not found", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstItem.mockResolvedValueOnce(null)
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no encontrado")
  })

  it("returns error if scope denied", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockCanAccessWorksite.mockReturnValueOnce(false)
    mockFindFirstItem.mockResolvedValueOnce(makeItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("acceso")
  })

  it("returns error for invalid modifiedQty", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const res = await approveItemAction(prevState, makeFormData({ modifiedQty: "-5" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("positivo")
  })

  it("approves item successfully", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstItem.mockResolvedValueOnce(makeItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockApproveItem).toHaveBeenCalledWith("item-1", "user-1", expect.objectContaining({
      userEmail: "admin@test.cl",
      roleContext: "admin",
    }))
  })

  it("propagates service error", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstItem.mockResolvedValueOnce(makeItemBefore())
    mockApproveItem.mockRejectedValueOnce(new Error("Cannot approve"))
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Cannot approve")
  })
})

describe("rejectItemAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await rejectItemAction(prevState, makeFormData({ reason: "Bad" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if reason missing", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = makeFormData()
    fd.delete("reason")
    const res = await rejectItemAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("motivo")
  })

  it("rejects item successfully", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstItem.mockResolvedValueOnce(makeItemBefore())
    const res = await rejectItemAction(prevState, makeFormData({ reason: "No cumple" }))
    expect(res.ok).toBe(true)
    expect(mockRejectItem).toHaveBeenCalledWith("item-1", "user-1", "No cumple", expect.any(Object))
  })
})

describe("returnItemAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await returnItemAction(prevState, makeFormData({ reason: "Fix" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if reason missing", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = makeFormData()
    fd.delete("reason")
    const res = await returnItemAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("obligatoria")
  })

  it("returns item successfully", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstItem.mockResolvedValueOnce(makeItemBefore())
    const res = await returnItemAction(prevState, makeFormData({ reason: "Falta detalle" }))
    expect(res.ok).toBe(true)
    expect(mockReturnItem).toHaveBeenCalledWith("item-1", "user-1", "Falta detalle", expect.any(Object))
  })
})

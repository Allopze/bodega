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
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirstItem.mockReset()
  })

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
      roleContext: "administrador",
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
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirstItem.mockReset()
  })

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
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirstItem.mockReset()
  })

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

// ── EPP approval gating (MISS-04) ─────────────────────────────────────────────
// Business rule: EPP requests originate from prevencionista; only
// jefatura / secretaría / administrador can approve, reject, or return them.

function makeEppItemBefore() {
  return {
    id: "item-epp-1",
    status: "requested",
    request: { id: "req-epp", code: "SOL-EPP", requesterId: "user-prev", worksiteId: "ws-1", requestType: "epp" },
  }
}

describe("EPP approval gating (MISS-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset findFirst mock to avoid leftover resolved values from other blocks
    mockFindFirstItem.mockReset()
  })

  // ── approveItemAction ──────────────────────────────────────────────────────

  it("approveItemAction: blocks EPP approval by non-authorized role (prevencionista)", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["prevencionista"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("EPP")
    expect(res.message).toContain("Jefatura o Secretaría")
    expect(mockApproveItem).not.toHaveBeenCalled()
  })

  it("approveItemAction: allows EPP approval by jefa_chome", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["jefa_chome"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    // approveItem receives itemId from formData ("item-1"), not from findFirst result
    expect(mockApproveItem).toHaveBeenCalledWith("item-1", "user-1", expect.objectContaining({
      roleContext: "jefa_chome",
    }))
  })

  it("approveItemAction: allows EPP approval by secretaria", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["secretaria"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockApproveItem).toHaveBeenCalled()
  })

  it("approveItemAction: allows EPP approval by administrador", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["administrador"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockApproveItem).toHaveBeenCalled()
  })

  it("approveItemAction: allows non-EPP approval by any role with permission", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["prevencionista"] }))
    // makeItemBefore() returns a request without requestType (no "epp")
    mockFindFirstItem.mockResolvedValueOnce(makeItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockApproveItem).toHaveBeenCalled()
  })

  // ── rejectItemAction ───────────────────────────────────────────────────────

  it("rejectItemAction: blocks EPP rejection by non-authorized role", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["prevencionista"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await rejectItemAction(prevState, makeFormData({ reason: "No cumple norma" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("EPP")
    expect(mockRejectItem).not.toHaveBeenCalled()
  })

  it("rejectItemAction: allows EPP rejection by jefa_chome", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["jefa_chome"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await rejectItemAction(prevState, makeFormData({ reason: "No cumple" }))
    expect(res.ok).toBe(true)
    expect(mockRejectItem).toHaveBeenCalled()
  })

  // ── returnItemAction ───────────────────────────────────────────────────────

  it("returnItemAction: blocks EPP return by non-authorized role", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["prevencionista"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await returnItemAction(prevState, makeFormData({ reason: "Falta detalle" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("EPP")
    expect(mockReturnItem).not.toHaveBeenCalled()
  })

  it("returnItemAction: allows EPP return by secretaria", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["secretaria"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await returnItemAction(prevState, makeFormData({ reason: "Corregir" }))
    expect(res.ok).toBe(true)
    expect(mockReturnItem).toHaveBeenCalled()
  })

  // ── Multi-role: user with both authorized and unauthorized roles ────────────

  it("approveItemAction: allows EPP when user has at least one authorized role", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["prevencionista", "secretaria"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockApproveItem).toHaveBeenCalled()
  })
})

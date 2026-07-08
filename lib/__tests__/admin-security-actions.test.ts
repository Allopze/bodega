/**
 * Unit tests for the rate-limit administration actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockClearRateLimitRecord = vi.hoisted(() => vi.fn())
const mockPruneExpiredLocks = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}))
vi.mock("@/lib/services/rate-limit", () => ({
  clearRateLimitRecord: mockClearRateLimitRecord,
  pruneExpiredLocks: mockPruneExpiredLocks,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  clearRateLimitKeyAction,
  pruneRateLimitLocksAction,
} from "@/app/(app)/admin/seguridad/actions"
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
      permissions: ["admin:security"],
      worksiteIds: [],
      primaryWorksiteId: "",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

describe("clearRateLimitKeyAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("requires admin:security", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const fd = new FormData(); fd.set("key", "ip:1.2.3.4")
    const res = await clearRateLimitKeyAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("rejects a missing key", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = new FormData()
    const res = await clearRateLimitKeyAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Key requerida")
  })

  it("clears the record and audits as rate_limit:delete", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockClearRateLimitRecord.mockResolvedValueOnce(1)
    const fd = new FormData(); fd.set("key", "ip:1.2.3.4")
    const res = await clearRateLimitKeyAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockClearRateLimitRecord).toHaveBeenCalledWith("ip:1.2.3.4")
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "delete",
      entityType: "rate_limit",
      entityId: "ip:1.2.3.4",
    }))
  })
})

describe("pruneRateLimitLocksAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("requires admin:security", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await pruneRateLimitLocksAction(prevState)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("prunes and audits", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockPruneExpiredLocks.mockResolvedValueOnce(undefined)
    const res = await pruneRateLimitLocksAction(prevState)
    expect(res.ok).toBe(true)
    expect(mockPruneExpiredLocks).toHaveBeenCalled()
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "rate_limit",
      entityId: "prune_expired",
    }))
  })
})

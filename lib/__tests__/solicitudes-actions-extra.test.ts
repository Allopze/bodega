/**
 * Additional unit tests for solicitudes Server Actions (coverage 36.61% → now covered).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockRequireAuth = vi.hoisted(() => vi.fn())
const mockCanAccessWorksite = vi.hoisted(() => vi.fn(() => true))
const mockCan = vi.hoisted(() => vi.fn(() => true))
const mockFindFirstRequest = vi.hoisted(() => vi.fn())
const mockFindManyItems = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  requireAuth: mockRequireAuth,
  canAccessWorksite: mockCanAccessWorksite,
  can: mockCan,
}))
vi.mock("@/db", () => {
  const db = {
    query: {
      purchaseRequests: { findFirst: mockFindFirstRequest },
      purchaseRequestItems: { findMany: mockFindManyItems },
      products: { findMany: vi.fn(() => []) },
    },
    select: vi.fn(() => {
      const row = { id: "item-1", status: "returned", requestId: "req-1", requesterId: "user-1", worksiteId: "ws-1" }
      return { from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ then: vi.fn((cb: (rows: typeof row[]) => unknown) => cb([row])) })) })) })) }
    }),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    transaction: vi.fn(async <T,>(fn: (tx: typeof db) => T): Promise<T> => fn(db)),
    delete: vi.fn(() => ({ where: vi.fn() })),
  }
  return { db }
})
vi.mock("@/lib/services/requests-delete", () => ({
  deleteRequest: vi.fn(),
}))
vi.mock("@/lib/services/item-state", () => ({
  submitItem: vi.fn(),
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
  recordStatusChange: vi.fn(),
}))
vi.mock("@/lib/services/notifications", () => ({
  notifyManyUser: vi.fn(),
  getUserIdsWithPermission: vi.fn(() => Promise.resolve([])),
  notifyAfterCommit: vi.fn((fn: () => unknown) => fn()),
}))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/lib/request-types", () => ({
  isRequestType: vi.fn(() => true),
  permissionForRequestType: vi.fn(() => "requests:view_own"),
  QUOTATION_TYPES: new Set(["repuestos", "servicios"]),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { cancelRequest, resubmitReturnedItemAction, deleteRequestAction } from "@/app/(app)/solicitudes/actions"
import type { ActionState } from "@/lib/validation/operations"

const prevState: ActionState = { ok: false, message: "" }

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1", email: "admin@test.cl", name: "Admin",
      roles: ["administrador"],
      permissions: ["requests:create", "requests:view_own", "requests:view_all", "requests:delete"],
      worksiteIds: ["ws-1"], primaryWorksiteId: "ws-1",
      avatarColor: "#000", isActive: true,
    },
  }
}

describe("cancelRequest", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const fd = new FormData()
    fd.set("requestId", "req-1")
    const res = await cancelRequest(prevState, fd)
    expect(res.ok).toBe(false)
  })

  it("returns error if requestId missing", async () => {
    const fd = new FormData()
    const res = await cancelRequest(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("ID requerido")
  })

  it("returns error if request not found", async () => {
    mockFindFirstRequest.mockResolvedValueOnce(undefined)
    const fd = new FormData()
    fd.set("requestId", "req-1")
    const res = await cancelRequest(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Solicitud no encontrada")
  })

  it("returns error if status is not cancellable", async () => {
    mockFindFirstRequest.mockResolvedValueOnce({
      id: "req-1", status: "approved", requesterId: "user-1", worksiteId: "ws-1", code: "SOL-001",
      items: [{ id: "item-1", status: "approved" }],
    })
    const fd = new FormData()
    fd.set("requestId", "req-1")
    const res = await cancelRequest(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No se puede cancelar")
  })

  it("requires a reason when cancelling a submitted request", async () => {
    mockFindFirstRequest.mockResolvedValueOnce({
      id: "req-1", status: "submitted", requesterId: "user-1", worksiteId: "ws-1", code: "SOL-001",
      items: [{ id: "item-1", status: "requested" }],
    })
    const fd = new FormData()
    fd.set("requestId", "req-1")
    const res = await cancelRequest(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("motivo")
  })

  it("cancels a submitted request with reason when no item has entered purchasing", async () => {
    mockFindFirstRequest.mockResolvedValueOnce({
      id: "req-1", status: "submitted", requesterId: "user-1", worksiteId: "ws-1", code: "SOL-001",
      items: [{ id: "item-1", status: "requested" }],
    })
    const fd = new FormData()
    fd.set("requestId", "req-1")
    fd.set("reason", "Necesidad anulada")

    await expect(cancelRequest(prevState, fd)).rejects.toThrow("NEXT_REDIRECT")
  })

  it("blocks submitted request cancellation after an item entered purchasing", async () => {
    mockFindFirstRequest.mockResolvedValueOnce({
      id: "req-1", status: "submitted", requesterId: "user-1", worksiteId: "ws-1", code: "SOL-001",
      items: [{ id: "item-1", status: "purchased" }],
    })
    const fd = new FormData()
    fd.set("requestId", "req-1")
    fd.set("reason", "Necesidad anulada")
    const res = await cancelRequest(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("compra")
  })
})

describe("resubmitReturnedItemAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequireAuth.mockResolvedValue(makeSession())
  })

  it("returns error if not authenticated", async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error("no"))
    const fd = new FormData()
    fd.set("itemId", "item-1")
    const res = await resubmitReturnedItemAction(prevState, fd)
    expect(res.ok).toBe(false)
  })

  it("returns error if itemId missing", async () => {
    const fd = new FormData()
    const res = await resubmitReturnedItemAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Ítem no especificado")
  })
})

describe("deleteRequestAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const fd = new FormData()
    fd.set("requestId", "req-1")
    const res = await deleteRequestAction(prevState, fd)
    expect(res.ok).toBe(false)
  })

  it("returns error if requestId missing", async () => {
    const fd = new FormData()
    const res = await deleteRequestAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("ID requerido")
  })

  it("returns error if request not found", async () => {
    mockFindFirstRequest.mockResolvedValueOnce(undefined)
    const fd = new FormData()
    fd.set("requestId", "req-1")
    const res = await deleteRequestAction(prevState, fd)
    expect(res.ok).toBe(false)
  })
})

/**
 * Unit tests for submitRequest action (solicitudes/actions.ts).
 *
 * Covers:
 *  1. Permission denied (no requests:submit for the request type)
 *  2. Missing requestId in FormData
 *  3. Request not found in DB
 *  4. Request in wrong status (non-draft)
 *  5. Request with no items
 *  6. User is not the requester (and lacks view_all)
 *  7. Request type not supported
 *  8. Happy path (redirects)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { redirect } from "next/navigation"

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT") }),
}))

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockFindFirst = vi.hoisted(() => vi.fn())
const mockSubmitItemTx = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseRequests: { findFirst: mockFindFirst },
    },
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const fakeTx = {
        query: { purchaseRequestItems: { findFirst: vi.fn().mockResolvedValue(null) } },
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      }
      return fn(fakeTx)
    }),
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/notifications", () => ({
  notifyManyUser: vi.fn(),
  getUserIdsWithPermission: vi.fn().mockResolvedValue([]),
  notifyAfterCommit: vi.fn((fn: () => Promise<unknown>) => fn()),
  notifySafe: vi.fn(),
}))
vi.mock("@/lib/services/item-state", () => ({
  submitItemTx: mockSubmitItemTx,
}))

import { submitRequest } from "@/app/(app)/solicitudes/actions"
import type { ActionState } from "@/lib/validation/operations"

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "user@test.cl",
      name: "User",
      roles: ["solicitante_faena"],
      permissions: ["requests:submit"],
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: "#000",
      isActive: true,
      ...overrides,
    },
  }
}

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("requestId", "req-1")
  for (const [k, v] of Object.entries(overrides)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

const prevState: ActionState = { ok: false, message: "" }

describe("submitRequest (solicitudes)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(redirect).mockImplementation(() => { throw new Error("NEXT_REDIRECT") })
    mockFindFirst.mockResolvedValue({
      id: "req-1",
      status: "draft",
      worksiteId: "ws-1",
      requesterId: "user-1",
      requestType: "epp",
      code: "SOL-2026-0001",
      items: [{ id: "item-1", status: "draft" }],
    })
    mockSubmitItemTx.mockResolvedValue(undefined)
  })

  it("returns error if user lacks permission", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: [] }))
    const res = await submitRequest(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/permisos/i)
  })

  it("returns error if requestId is empty", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const res = await submitRequest(prevState, makeFormData({ requestId: "" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("requerido")
  })

  it("returns error if request not found", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockFindFirst.mockResolvedValueOnce(null)
    const res = await submitRequest(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no encontrada")
  })

  it("returns error if request is already submitted", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockFindFirst.mockResolvedValueOnce({
      id: "req-1",
      status: "submitted",
      worksiteId: "ws-1",
      requesterId: "user-1",
      requestType: "epp",
      code: "SOL-2026-0001",
      items: [{ id: "item-1", status: "requested" }],
    })
    const res = await submitRequest(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/solo se pueden enviar/i)
  })

  it("returns error if request has no items", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockFindFirst.mockResolvedValueOnce({
      id: "req-1",
      status: "draft",
      worksiteId: "ws-1",
      requesterId: "user-1",
      requestType: "epp",
      code: "SOL-2026-0001",
      items: [],
    })
    const res = await submitRequest(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("al menos un")
  })

  it("returns error if user is not the requester", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockFindFirst.mockResolvedValueOnce({
      id: "req-1",
      status: "draft",
      worksiteId: "ws-1",
      requesterId: "other-user",
      requestType: "epp",
      code: "SOL-2026-0001",
      items: [{ id: "item-1", status: "draft" }],
    })
    const res = await submitRequest(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/propia/i)
  })

  it("returns error if request type is not supported", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockFindFirst.mockResolvedValueOnce({
      id: "req-1",
      status: "draft",
      worksiteId: "ws-1",
      requesterId: "user-1",
      requestType: "invalid_type",
      code: "SOL-2026-0001",
      items: [{ id: "item-1", status: "draft" }],
    })
    const res = await submitRequest(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no soportado")
  })

  it("redirects on happy path", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    await expect(submitRequest(prevState, makeFormData())).rejects.toThrow("NEXT_REDIRECT")
    expect(redirect).toHaveBeenCalledWith("/solicitudes/req-1")
  })
})

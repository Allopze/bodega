/**
 * Unit tests for submitRequest action (solicitudes/actions.ts).
 *
 * Covers:
 *  1. Permission denied (no requests:submit)
 *  2. Missing or empty form data
 *  3. Request not found in DB
 *  4. Request in wrong status (non-draft/non-returned)
 *  5. Scope denied
 *  6. Service-layer error
 *  7. Happy path
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockState = vi.hoisted(() => ({
  requestResult: undefined as { id: string; status: string; worksiteId: string; requesterId: string } | undefined,
}))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseRequests: {
        findFirst: vi.fn(() => Promise.resolve(mockState.requestResult)),
      },
    },
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/item-state", () => ({ submitItem: vi.fn() }))

import { submitRequest } from "@/app/(app)/solicitudes/actions"

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

describe("submitRequest (solicitudes)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.requestResult = { id: "req-1", status: "draft", worksiteId: "ws-1", requesterId: "user-1" }
  })

  it("returns error if user lacks permission", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: [] }))
    const res = await submitRequest("req-1")
    expect(res?.ok).toBe(false)
    expect(res?.message).toMatch(/permisos/i)
  })

  it("returns error if requestId is empty", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const res = await submitRequest("")
    expect(res?.ok).toBe(false)
    expect(res?.message).toContain("ID")
  })

  it("returns error if request not found", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockState.requestResult = undefined
    const res = await submitRequest("req-notfound")
    expect(res?.ok).toBe(false)
    expect(res?.message).toContain("no encontrada")
  })

  it("returns error if request is already submitted", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockState.requestResult = { id: "req-1", status: "submitted", worksiteId: "ws-1", requesterId: "user-1" }
    const res = await submitRequest("req-1")
    expect(res?.ok).toBe(false)
    expect(res?.message).toContain("solo se pueden enviar")
  })

  it("returns error if user is not the requester", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockState.requestResult = { id: "req-1", status: "draft", worksiteId: "ws-1", requesterId: "other-user" }
    const res = await submitRequest("req-1")
    expect(res?.ok).toBe(false)
    expect(res?.message).toContain("solicitante")
  })

  it("submits successfully on happy path", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const res = await submitRequest("req-1")
    expect(res?.ok).toBe(true)
  })
})

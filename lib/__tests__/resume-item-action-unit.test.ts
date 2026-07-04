/**
 * Unit tests for resumeItemAction — access control & validation hardening.
 *
 * Covers every guard in the action:
 *  1. Permission denied
 *  2. Missing itemId
 *  3. Item not found (DB returns nothing)
 *  4. Item status not "postponed"
 *  5. Worksite (faena) access denied / granted
 *  6. Service-layer error
 *  7. Happy path — markItemPendingPurchase called with correct args
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

// ── Hoisted mutable state: controls what the mocked DB returns ─────────────────
const mockState = vi.hoisted(() => ({
  itemResult: undefined as { id: string; status: string; worksiteId: string } | undefined,
}))

const mockAuthFn = vi.hoisted(() => vi.fn())

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))

// Mock the Drizzle/postgres-js database. Stubs the exact query shape:
//   await db.select(...).from(...).innerJoin(...).where(...)   // thenable
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            then: (fn: (rows: unknown[]) => unknown) =>
              fn(mockState.itemResult ? [mockState.itemResult] : []),
          })),
        })),
      })),
    })),
  },
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const mockMarkItemPendingPurchase = vi.hoisted(() => vi.fn())
vi.mock("@/lib/services/item-state", () => ({ markItemPendingPurchase: mockMarkItemPendingPurchase }))

// ── Import after mocks ─────────────────────────────────────────────────────────
import { resumeItemAction } from "@/app/(app)/compras/actions"

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("itemId", "item-123")
  for (const [k, v] of Object.entries(overrides)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

function makeSession(overrides: Partial<Session["user"]> = {}): Session {
  return {
    expires: "9999-12-31",
    user: {
      id:                "u-test",
      name:              "Test User",
      email:             "test@chome.cl",
      roles:             [],
      permissions:       ["purchasing:create_order"],
      worksiteIds:       [],
      primaryWorksiteId: null,
      avatarColor:       null,
      isActive:          true,
      ...overrides,
    },
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("resumeItemAction — access & validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.itemResult = undefined
  })

  // ── Permission gate ───────────────────────────────────────────────────────

  it("rejects unauthenticated users", async () => {
    mockAuthFn.mockResolvedValue(null)

    const result = await resumeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(false)
    expect(result.message).toBe("Sin permisos")
  })

  it("rejects users without purchasing:create_order permission", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ permissions: [] }))

    const result = await resumeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(false)
    expect(result.message).toBe("Sin permisos")
  })

  // ── Input validation ──────────────────────────────────────────────────────

  it("rejects missing itemId", async () => {
    mockAuthFn.mockResolvedValue(makeSession())

    const result = await resumeItemAction({ ok: false, message: "" }, makeFormData({ itemId: "" }))

    expect(result.ok).toBe(false)
    expect(result.message).toBe("Ítem no especificado")
  })

  // ── Item existence ────────────────────────────────────────────────────────

  it("rejects when item is not found in DB", async () => {
    mockAuthFn.mockResolvedValue(makeSession())
    mockState.itemResult = undefined

    const result = await resumeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(false)
    expect(result.message).toBe("Ítem no encontrado")
  })

  // ── Status validation ─────────────────────────────────────────────────────

  it.each(["draft", "requested", "approved", "rejected", "returned", "pending_purchase", "in_purchase_order", "purchased", "received", "delivered"])(
    "rejects item in status '%s'",
    async (status) => {
      mockAuthFn.mockResolvedValue(makeSession())
      mockState.itemResult = { id: "item-123", status, worksiteId: "ws-1" }

      const result = await resumeItemAction({ ok: false, message: "" }, makeFormData())

      expect(result.ok).toBe(false)
      expect(result.message).toBe("Solo se pueden reanudar ítems postergados")
    },
  )

  it("allows item in status 'postponed' (pending access check)", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ worksiteIds: ["ws-1"] }))
    mockState.itemResult = { id: "item-123", status: "postponed", worksiteId: "ws-1" }

    const result = await resumeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(true)
  })

  // ── Worksite (faena) access ──────────────────────────────────────────────

  it("rejects when user does NOT have access to the item's worksite (faena)", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ worksiteIds: ["ws-other"] }))
    mockState.itemResult = { id: "item-123", status: "postponed", worksiteId: "ws-restricted" }

    const result = await resumeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(false)
    expect(result.message).toBe("No tienes acceso a la faena de este ítem")
  })

  it("allows when user has the worksite explicitly assigned", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ worksiteIds: ["ws-faena-1"] }))
    mockState.itemResult = { id: "item-123", status: "postponed", worksiteId: "ws-faena-1" }

    const result = await resumeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(true)
  })

  it("allows access for administrador role regardless of assigned worksites", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ roles: ["administrador"], worksiteIds: [] }))
    mockState.itemResult = { id: "item-123", status: "postponed", worksiteId: "ws-cualquiera" }

    const result = await resumeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(true)
  })

  it("allows access for jefa_chome role regardless of assigned worksites", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ roles: ["jefa_chome"], worksiteIds: [] }))
    mockState.itemResult = { id: "item-123", status: "postponed", worksiteId: "ws-cualquiera" }

    const result = await resumeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(true)
  })

  // ── Service-layer error handling ──────────────────────────────────────────

  it("returns error message when markItemPendingPurchase service throws", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ worksiteIds: ["ws-faena-1"] }))
    mockState.itemResult = { id: "item-123", status: "postponed", worksiteId: "ws-faena-1" }
    mockMarkItemPendingPurchase.mockRejectedValueOnce(new Error("Estado inválido para reanudar"))

    const result = await resumeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(false)
    expect(result.message).toBe("Estado inválido para reanudar")
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  it("calls markItemPendingPurchase with correct arguments on success", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ worksiteIds: ["ws-faena-1"] }))
    mockState.itemResult = { id: "item-123", status: "postponed", worksiteId: "ws-faena-1" }

    const result = await resumeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(true)
    expect(result.message).toBe("Ítem reanudado para compra")
    expect(mockMarkItemPendingPurchase).toHaveBeenCalledWith(
      "item-123",
      "u-test",
      { userEmail: "test@chome.cl" },
    )
  })

  it("passes userEmail as undefined when session has no email", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ worksiteIds: ["ws-faena-1"], email: undefined }))
    mockState.itemResult = { id: "item-123", status: "postponed", worksiteId: "ws-faena-1" }

    await resumeItemAction({ ok: false, message: "" }, makeFormData())

    expect(mockMarkItemPendingPurchase).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { userEmail: undefined },
    )
  })
})

/**
 * Unit tests for cancelRequest — permission gate, authorization & validation.
 *
 * Covers every guard in the action:
 *  1. Permission gate (authenticated + requests:create OR requests:view_all)
 *  2. Input validation (missing requestId)
 *  3. Request existence
 *  4. Status validation (cancellable vs non-cancellable)
 *  5. Reason validation (required for submitted/in_review/partially_approved)
 *  6. Ownership (own vs other's request)
 *  7. Worksite (faena) access denied / granted
 *  8. Locked items check
 *  9. Transaction success (happy path)
 * 10. jefa_chome: has requests:view_all but NOT requests:create
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

// ── Hoisted mutable state ──────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  requestResult: undefined as {
    id: string; status: string; requesterId: string; worksiteId: string; code: string
    items: Array<{ id: string; status: string }>
  } | undefined,
}))

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockRedirect = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_REDIRECT") }))

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))

vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseRequests: {
        findFirst: vi.fn(() => mockState.requestResult),
      },
    },
    transaction: vi.fn(async (cb: (tx: Record<string, (...args: unknown[]) => unknown>) => Promise<void>) => {
      const fakeTx = {
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
      }
      await cb(fakeTx)
    }),
  },
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect }))

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
  recordStatusChange: vi.fn(),
}))

// ── Import after mocks ───────────────────────────────────────────────────────

import { cancelRequest } from "@/app/(app)/solicitudes/actions"

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("requestId", "req-123")
  fd.set("reason", "Ya no se necesita esta solicitud")
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
      permissions:       [],
      worksiteIds:       [],
      primaryWorksiteId: null,
      avatarColor:       null,
      isActive:          true,
      ...overrides,
    },
  }
}

function makeRequest(overrides: Partial<{
  id: string; status: string; requesterId: string; worksiteId: string; code: string
  items: Array<{ id: string; status: string }>
}> = {}): typeof mockState.requestResult {
  return {
    id: "req-123",
    status: "submitted",
    requesterId: "u-requester",
    worksiteId: "ws-1",
    code: "SOL-001",
    items: [{ id: "item-1", status: "approved" }],
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("cancelRequest — permission, validation & authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.requestResult = undefined
  })

  // ── Permission gate ───────────────────────────────────────────────────────

  describe("permission gate", () => {
    it("rejects unauthenticated users", async () => {
      mockAuthFn.mockResolvedValue(null)
      const result = await cancelRequest({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Sin permisos")
    })

    it("rejects users without requests:create AND without requests:view_all", async () => {
      mockAuthFn.mockResolvedValue(makeSession({ permissions: ["some:other"] }))
      const result = await cancelRequest({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Sin permisos para cancelar solicitudes")
    })

    it("allows users with only requests:create through the permission gate", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:create"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test" })
      await expect(cancelRequest({ ok: false, message: "" }, makeFormData()))
        .rejects.toThrow("NEXT_REDIRECT")
    })

    // ═══════════════════════════════════════════════════════════════════════
    //  KEY TEST: jefa_chome has view_all but NOT create
    // ═══════════════════════════════════════════════════════════════════════

    it("allows jefa_chome (requests:view_all without requests:create) through the permission gate", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        roles: ["jefa_chome"],
        permissions: ["requests:view_all", "requests:delete"],
        // No requests:create
        worksiteIds: [],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test" })
      await expect(cancelRequest({ ok: false, message: "" }, makeFormData()))
        .rejects.toThrow("NEXT_REDIRECT")
    })
  })

  // ── Input validation ──────────────────────────────────────────────────────

  describe("input validation", () => {
    it("rejects missing requestId", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:create"],
        worksiteIds: ["ws-1"],
      }))
      const result = await cancelRequest({ ok: false, message: "" }, makeFormData({ requestId: "" }))
      expect(result.ok).toBe(false)
      expect(result.message).toBe("ID requerido")
    })
  })

  // ── Request existence ─────────────────────────────────────────────────────

  describe("request existence", () => {
    it("rejects when request is not found in DB", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:create"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = undefined
      const result = await cancelRequest({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Solicitud no encontrada")
    })
  })

  // ── Status validation ─────────────────────────────────────────────────────

  describe("status validation", () => {
    it.each(["draft", "returned", "submitted", "in_review", "partially_approved"])(
      "allows cancellable status '%s' (pending further checks)", async (status) => {
        mockAuthFn.mockResolvedValue(makeSession({
          permissions: ["requests:create"],
          worksiteIds: ["ws-1"],
        }))
        mockState.requestResult = makeRequest({ status, requesterId: "u-test" })
        await expect(cancelRequest({ ok: false, message: "" }, makeFormData()))
          .rejects.toThrow("NEXT_REDIRECT")
      },
    )

    it.each(["approved", "pending_purchase", "in_purchase_order", "purchased",
             "partially_received", "received", "partially_delivered", "delivered", "cancelled"])(
      "rejects non-cancellable status '%s'", async (status) => {
        mockAuthFn.mockResolvedValue(makeSession({
          permissions: ["requests:view_all"],
        }))
        mockState.requestResult = makeRequest({ status })
        const result = await cancelRequest({ ok: false, message: "" }, makeFormData())
        expect(result.ok).toBe(false)
        expect(result.message).toContain("No se puede cancelar")
      },
    )
  })

  // ── Reason validation ─────────────────────────────────────────────────────

  describe("reason validation", () => {
    it("rejects missing reason for submitted request", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:create"],
      }))
      mockState.requestResult = makeRequest({ status: "submitted", requesterId: "u-test" })
      const result = await cancelRequest({ ok: false, message: "" }, makeFormData({ reason: "" }))
      expect(result.ok).toBe(false)
      expect(result.message).toBe("El motivo de cancelación es obligatorio")
    })

    it("allows missing reason for draft request", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:create"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = makeRequest({ status: "draft", requesterId: "u-test" })
      await expect(cancelRequest({ ok: false, message: "" }, makeFormData({ reason: "" })))
        .rejects.toThrow("NEXT_REDIRECT")
    })
  })

  // ── Ownership ─────────────────────────────────────────────────────────────

  describe("ownership", () => {
    it("allows canceling own request with requests:create", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:create"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test" })
      await expect(cancelRequest({ ok: false, message: "" }, makeFormData()))
        .rejects.toThrow("NEXT_REDIRECT")
    })

    it("rejects canceling another user's request without requests:view_all", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:create"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-other-person" })
      const result = await cancelRequest({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Solo puedes cancelar tus propias solicitudes")
    })

    it("allows jefa_chome (requests:view_all) to cancel another user's request", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        roles: ["jefa_chome"],
        permissions: ["requests:view_all"],
        // No requests:create
        worksiteIds: [],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-other-person" })
      await expect(cancelRequest({ ok: false, message: "" }, makeFormData()))
        .rejects.toThrow("NEXT_REDIRECT")
    })

    it("allows jefa_chome (requests:view_all) to cancel own request", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        id: "u-jefa",
        roles: ["jefa_chome"],
        permissions: ["requests:view_all"],
        worksiteIds: [],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-jefa" })
      await expect(cancelRequest({ ok: false, message: "" }, makeFormData()))
        .rejects.toThrow("NEXT_REDIRECT")
    })
  })

  // ── Worksite (faena) access ──────────────────────────────────────────────

  describe("worksite access", () => {
    it("rejects when user does NOT have access to the request's worksite", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:create"],
        worksiteIds: ["ws-other"],
        roles: [],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test", worksiteId: "ws-restricted" })
      const result = await cancelRequest({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toBe("No tienes acceso a la faena de esta solicitud")
    })

    it("allows when user has the worksite explicitly assigned", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:create"],
        worksiteIds: ["ws-faena-1"],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test", worksiteId: "ws-faena-1" })
      await expect(cancelRequest({ ok: false, message: "" }, makeFormData()))
        .rejects.toThrow("NEXT_REDIRECT")
    })

    it("allows access for administrador role regardless of assigned worksites", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        roles: ["administrador"],
        permissions: ["requests:create"],
        worksiteIds: [],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test", worksiteId: "ws-cualquiera" })
      await expect(cancelRequest({ ok: false, message: "" }, makeFormData()))
        .rejects.toThrow("NEXT_REDIRECT")
    })

    it("allows access for jefa_chome role regardless of assigned worksites", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        roles: ["jefa_chome"],
        permissions: ["requests:view_all"],
        worksiteIds: [],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-other", worksiteId: "ws-cualquiera" })
      await expect(cancelRequest({ ok: false, message: "" }, makeFormData()))
        .rejects.toThrow("NEXT_REDIRECT")
    })
  })

  // ── Locked items check ────────────────────────────────────────────────────

  describe("locked items", () => {
    it("rejects when request has items in locked status", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:view_all"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = makeRequest({
        requesterId: "u-other",
        items: [{ id: "item-1", status: "in_purchase_order" }],
      })
      const result = await cancelRequest({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toContain("No se puede cancelar")
    })
  })

  // ── Transaction success ───────────────────────────────────────────────────

  describe("success path", () => {
    it("completes the transaction and redirects for a valid cancellation", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:create"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test" })

      await expect(cancelRequest({ ok: false, message: "" }, makeFormData()))
        .rejects.toThrow("NEXT_REDIRECT")

      // Verify the transaction was executed
      const { db } = await import("@/db")
      expect(db.transaction).toHaveBeenCalledOnce()
    })
  })
})

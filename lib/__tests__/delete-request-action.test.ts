/**
 * Unit tests for deleteRequestAction — permission gate, authorization & validation.
 *
 * Covers every guard in the action:
 *  1. Permission gate (requests:view_own OR requests:delete OR requests:view_all)
 *  2. Input validation (missing requestId)
 *  3. Request existence
 *  4. Ownership (own vs other's request)
 *  5. Worksite (faena) access denied / granted
 *  6. Service-layer error
 *  7. Success path
 *  8. jefa_chome: has requests:delete but NOT requests:view_own
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

// ── Hoisted mutable state ──────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  requestResult: undefined as {
    id: string; requesterId: string; worksiteId: string; status: string
  } | undefined,
}))

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockDeleteRequest = vi.hoisted(() => vi.fn())

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))

vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseRequests: {
        findFirst: vi.fn(() => mockState.requestResult),
      },
    },
  },
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/requests-delete", () => ({ deleteRequest: mockDeleteRequest }))

// ── Import after mocks ─────────────────────────────────────────────────────────

import { deleteRequestAction } from "@/app/(app)/solicitudes/actions"

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("requestId", "req-123")
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
  id: string; requesterId: string; worksiteId: string; status: string
}> = {}): typeof mockState.requestResult {
  return {
    id: "req-123",
    requesterId: "u-requester",
    worksiteId: "ws-1",
    status: "draft",
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("deleteRequestAction — permission & authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.requestResult = undefined
    mockDeleteRequest.mockResolvedValue(undefined)
  })

  // ── Permission gate ───────────────────────────────────────────────────────

  describe("permission gate", () => {
    it("rejects unauthenticated users", async () => {
      mockAuthFn.mockResolvedValue(null)
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Sin permisos")
    })

    it("rejects users without requests:view_own AND without requests:delete AND without requests:view_all", async () => {
      mockAuthFn.mockResolvedValue(makeSession({ permissions: ["some:other"] }))
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Sin permisos para eliminar solicitudes")
    })

    it("allows users with only requests:view_own through the permission gate", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:view_own"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test" })
      mockDeleteRequest.mockResolvedValue(undefined)
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(true)
    })

    // ═══════════════════════════════════════════════════════════════════════
    //  KEY TEST: jefa_chome has requests:delete but NOT requests:view_own
    // ═══════════════════════════════════════════════════════════════════════

    it("allows jefa_chome (requests:delete without requests:view_own) through the permission gate", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        roles: ["jefa_chome"],
        permissions: ["requests:delete", "requests:view_all"],
        // No requests:view_own
        worksiteIds: [],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test" })
      mockDeleteRequest.mockResolvedValue(undefined)
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(true)
    })
  })

  // ── Input validation ──────────────────────────────────────────────────────

  describe("input validation", () => {
    it("rejects missing requestId", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:view_own"],
        worksiteIds: ["ws-1"],
      }))
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData({ requestId: "" }))
      expect(result.ok).toBe(false)
      expect(result.message).toBe("ID requerido")
    })
  })

  // ── Request existence ─────────────────────────────────────────────────────

  describe("request existence", () => {
    it("rejects when request is not found in DB", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:view_own"],
      }))
      mockState.requestResult = undefined
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Solicitud no encontrada")
    })
  })

  // ── Ownership ─────────────────────────────────────────────────────────────

  describe("ownership", () => {
    it("allows deleting own request with only requests:view_own", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:view_own"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test" })
      mockDeleteRequest.mockResolvedValue(undefined)
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(true)
    })

    it("rejects deleting another user's request without requests:delete", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:view_own"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-other-person" })
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Solo puedes eliminar tus propias solicitudes")
    })

    it("rejects owner (without requests:delete) deleting a request in approval pipeline (B-1)", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:view_own"],
        worksiteIds: ["ws-1"],
      }))
      // submitted no es owner-deletable: requiere el permiso privilegiado.
      mockState.requestResult = makeRequest({ requesterId: "u-test", status: "submitted" })
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toContain("requiere permiso")
      expect(mockDeleteRequest).not.toHaveBeenCalled()
    })

    it("allows privileged deleter (requests:delete) to delete a submitted request", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        roles: ["secretaria"],
        permissions: ["requests:delete", "requests:view_all"],
        worksiteIds: [],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-other", status: "submitted" })
      mockDeleteRequest.mockResolvedValue(undefined)
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(true)
    })

    it("allows jefa_chome (requests:delete) to delete another user's request", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        roles: ["jefa_chome"],
        permissions: ["requests:delete", "requests:view_all"],
        worksiteIds: [],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-other-person" })
      mockDeleteRequest.mockResolvedValue(undefined)
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(true)
    })

    it("allows jefa_chome (requests:delete) to delete own request", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        id: "u-jefa",
        roles: ["jefa_chome"],
        permissions: ["requests:delete", "requests:view_all"],
        worksiteIds: [],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-jefa" })
      mockDeleteRequest.mockResolvedValue(undefined)
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(true)
    })
  })

  // ── Worksite (faena) access ──────────────────────────────────────────────

  describe("worksite access", () => {
    it("rejects when user does NOT have access to the request's worksite", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:view_own"],
        worksiteIds: ["ws-other"],
        roles: [],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test", worksiteId: "ws-restricted" })
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toBe("No tienes acceso a la faena de esta solicitud")
    })

    it("allows when user has the worksite explicitly assigned", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:view_own"],
        worksiteIds: ["ws-faena-1"],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test", worksiteId: "ws-faena-1" })
      mockDeleteRequest.mockResolvedValue(undefined)
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(true)
    })

    it("allows access for administrador role regardless of assigned worksites", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        roles: ["administrador"],
        permissions: ["requests:delete"],
        worksiteIds: [],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-other", worksiteId: "ws-cualquiera" })
      mockDeleteRequest.mockResolvedValue(undefined)
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(true)
    })

    it("allows access for jefa_chome role regardless of assigned worksites", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        roles: ["jefa_chome"],
        permissions: ["requests:delete"],
        worksiteIds: [],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-other", worksiteId: "ws-cualquiera" })
      mockDeleteRequest.mockResolvedValue(undefined)
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(true)
    })
  })

  // ── Service-layer error ─────────────────────────────────────────────────

  describe("service-layer error", () => {
    it("returns error message when deleteRequest service throws", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:view_own"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test" })
      mockDeleteRequest.mockRejectedValueOnce(new Error("Error de base de datos"))
      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Error al eliminar la solicitud")
    })
  })

  // ── Success path ─────────────────────────────────────────────────────────

  describe("success path", () => {
    it("calls deleteRequest with correct arguments and returns success message", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:view_own"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test" })
      mockDeleteRequest.mockResolvedValue(undefined)

      const result = await deleteRequestAction({ ok: false, message: "" }, makeFormData())

      expect(result.ok).toBe(true)
      expect(result.message).toBe("Solicitud eliminada correctamente")
      expect(mockDeleteRequest).toHaveBeenCalledWith(
        "req-123",
        "u-test",
        { userEmail: "test@chome.cl" },
      )
    })

    it("passes userEmail as undefined when session has no email", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:view_own"],
        worksiteIds: ["ws-1"],
        email: undefined,
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test" })
      mockDeleteRequest.mockResolvedValue(undefined)

      await deleteRequestAction({ ok: false, message: "" }, makeFormData())

      expect(mockDeleteRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { userEmail: undefined },
      )
    })
  })
})

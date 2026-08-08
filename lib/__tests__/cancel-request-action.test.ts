/**
 * Unit tests for cancelRequest — permission gate, authorization & the action's
 * own pre-check guards.
 *
 * La validación de negocio (estado cancelable, motivo obligatorio, ítems ya
 * bloqueados, rechazo de ítems abiertos) vive ahora en el servicio unificado
 * `cancelRequestTx` (lib/requests/request-service-module/cancel-request.ts,
 * F1-1/F1-2) y se prueba contra PGlite en cancel-request-service.test.ts —
 * ahí sí importa que corra dentro de una transacción real con locks. Este
 * archivo cubre solo lo que la action todavía decide por sí misma:
 *
 *  1. Permission gate (authenticated + requests:create OR requests:view_all)
 *  2. Input validation (missing requestId)
 *  3. Request existence
 *  4. Ownership (own vs other's request)
 *  5. Worksite (faena) access denied / granted
 *  6. Delega en el servicio y traduce su error a ActionState
 *  7. jefa_chome: has requests:view_all but NOT requests:create
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

// ── Hoisted mutable state ──────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  requestResult: undefined as {
    id: string; requesterId: string; worksiteId: string; code: string
  } | undefined,
}))

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockRedirect = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_REDIRECT") }))
const mockCancelRequestTx = vi.hoisted(() => vi.fn())

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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect }))

vi.mock("@/lib/requests/request-service-module/cancel-request", () => ({
  cancelRequest: mockCancelRequestTx,
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
  id: string; requesterId: string; worksiteId: string; code: string
}> = {}): typeof mockState.requestResult {
  return {
    id: "req-123",
    requesterId: "u-requester",
    worksiteId: "ws-1",
    code: "SOL-001",
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("cancelRequest — permission, validation & authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.requestResult = undefined
    mockCancelRequestTx.mockResolvedValue({ rejectedItemIds: [] })
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
      expect(mockCancelRequestTx).not.toHaveBeenCalled()
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
      expect(mockCancelRequestTx).not.toHaveBeenCalled()
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
      expect(mockCancelRequestTx).not.toHaveBeenCalled()
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
      expect(mockCancelRequestTx).not.toHaveBeenCalled()
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

  // ── Delegación en el servicio ─────────────────────────────────────────────

  describe("delegates to cancelRequestTx", () => {
    it("calls the service with requestId, userId, reason and redirects on success", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:create"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test" })

      await expect(cancelRequest({ ok: false, message: "" }, makeFormData({ reason: "Duplicada" })))
        .rejects.toThrow("NEXT_REDIRECT")

      expect(mockCancelRequestTx).toHaveBeenCalledWith(
        "req-123", "u-test", "Duplicada",
        expect.objectContaining({ userEmail: "test@chome.cl" }),
      )
    })

    it("translates a thrown error from the service into ok:false (estado no cancelable, ítems bloqueados, etc.)", async () => {
      mockAuthFn.mockResolvedValue(makeSession({
        permissions: ["requests:create"],
        worksiteIds: ["ws-1"],
      }))
      mockState.requestResult = makeRequest({ requesterId: "u-test" })
      mockCancelRequestTx.mockRejectedValue(new Error("No se puede cancelar: la solicitud ya tiene ítems en compra, recepción o entrega"))

      const result = await cancelRequest({ ok: false, message: "" }, makeFormData())
      expect(result.ok).toBe(false)
      expect(result.message).toBe("No se puede cancelar: la solicitud ya tiene ítems en compra, recepción o entrega")
    })
  })
})

/**
 * Unit tests for postponeItemAction — access control & validation hardening.
 *
 * Covers every guard in the action:
 *  1. Permission denied
 *  2. Missing itemId / reason
 *  3. Item not found (DB returns nothing)
 *  4. Item status not postponable
 *  5. Worksite (faena) access denied / granted
 *  6. Item already linked to a purchase order (OC)
 *  7. Service-layer error
 *  8. Happy path — postponeItem called with correct args
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

// ── Hoisted mutable state: controls what the mocked DB returns ─────────────────
// vi.hoisted is used so these refs are available in the vi.mock factories below.
const mockState = vi.hoisted(() => ({
  itemResult: undefined as { id: string; status: string; worksiteId: string } | undefined,
  orderLinkResult: undefined as unknown,
}))

const mockAuthFn = vi.hoisted(() => vi.fn())

// ── Module mocks ───────────────────────────────────────────────────────────────

// Mock next-auth so the can.ts module uses a fake auth() we control.
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))

// Mock the synchronous better-sqlite3 database.  The action chains
//   db.select(...).from(...).innerJoin(...).where(...).then(fn)
// and calls
//   db.query.purchaseOrderItems.findFirst(...)
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
    query: {
      purchaseOrderItems: {
        findFirst: vi.fn(() => mockState.orderLinkResult),
      },
    },
  },
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const mockPostponeItem = vi.hoisted(() => vi.fn())
vi.mock("@/lib/services/item-state", () => ({ postponeItem: mockPostponeItem }))

// ── Import after mocks ─────────────────────────────────────────────────────────
import { postponeItemAction } from "@/app/(app)/compras/actions"

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("itemId", "item-123")
  fd.set("reason", "Reprogramado para la próxima temporada")
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

describe("postponeItemAction — access & validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.itemResult = undefined
    mockState.orderLinkResult = undefined
  })

  // ── Permission gate ───────────────────────────────────────────────────────

  it("rejects unauthenticated users", async () => {
    mockAuthFn.mockResolvedValue(null)

    const result = await postponeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(false)
    expect(result.message).toBe("Sin permisos")
  })

  it("rejects users without purchasing:create_order permission", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ permissions: [] }))

    const result = await postponeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(false)
    expect(result.message).toBe("Sin permisos")
  })

  // ── Input validation ──────────────────────────────────────────────────────

  it("rejects missing itemId", async () => {
    mockAuthFn.mockResolvedValue(makeSession())

    const result = await postponeItemAction({ ok: false, message: "" }, makeFormData({ itemId: "" }))

    expect(result.ok).toBe(false)
    expect(result.message).toBe("Ítem no especificado")
  })

  it("rejects missing reason", async () => {
    mockAuthFn.mockResolvedValue(makeSession())

    const result = await postponeItemAction({ ok: false, message: "" }, makeFormData({ reason: "" }))

    expect(result.ok).toBe(false)
    expect(result.message).toBe("El motivo de postergación es obligatorio")
  })

  // ── Item existence ────────────────────────────────────────────────────────

  it("rejects when item is not found in DB", async () => {
    mockAuthFn.mockResolvedValue(makeSession())
    mockState.itemResult = undefined

    const result = await postponeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(false)
    expect(result.message).toBe("Ítem no encontrado")
  })

  // ── Status validation ─────────────────────────────────────────────────────

  it.each(["draft", "requested", "rejected", "returned", "in_purchase_order", "purchased", "received", "delivered"])(
    "rejects item in status '%s'",
    async (status) => {
      mockAuthFn.mockResolvedValue(makeSession())
      mockState.itemResult = { id: "item-123", status, worksiteId: "ws-1" }

      const result = await postponeItemAction({ ok: false, message: "" }, makeFormData())

      expect(result.ok).toBe(false)
      expect(result.message).toBe("Solo se pueden postergar ítems aprobados pendientes de compra")
    },
  )

  it.each(["approved", "pending_purchase"])(
    "allows item in status '%s' (pending access check)",
    async (status) => {
      mockAuthFn.mockResolvedValue(makeSession({ worksiteIds: ["ws-1"] }))
      mockState.itemResult = { id: "item-123", status, worksiteId: "ws-1" }
      mockState.orderLinkResult = null

      const result = await postponeItemAction({ ok: false, message: "" }, makeFormData())

      expect(result.ok).toBe(true)
    },
  )

  // ── Worksite (faena) access — the hardening the user asked about ──────────

  it("rejects when user does NOT have access to the item's worksite (faena)", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ worksiteIds: ["ws-other"] }))
    mockState.itemResult = { id: "item-123", status: "approved", worksiteId: "ws-restricted" }

    const result = await postponeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(false)
    expect(result.message).toBe("No tienes acceso a la faena de este ítem")
  })

  it("allows when user has the worksite explicitly assigned", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ worksiteIds: ["ws-faena-1"] }))
    mockState.itemResult = { id: "item-123", status: "approved", worksiteId: "ws-faena-1" }
    mockState.orderLinkResult = null

    const result = await postponeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(true)
  })

  it("allows access for administrador role regardless of assigned worksites", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ roles: ["administrador"], worksiteIds: [] }))
    mockState.itemResult = { id: "item-123", status: "approved", worksiteId: "ws-cualquiera" }
    mockState.orderLinkResult = null

    const result = await postponeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(true)
  })

  it("allows access for jefa_chome role regardless of assigned worksites", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ roles: ["jefa_chome"], worksiteIds: [] }))
    mockState.itemResult = { id: "item-123", status: "approved", worksiteId: "ws-cualquiera" }
    mockState.orderLinkResult = null

    const result = await postponeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(true)
  })

  // ── Purchase-order link check ─────────────────────────────────────────────

  it("rejects when item is already linked to a purchase order (OC)", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ worksiteIds: ["ws-faena-1"] }))
    mockState.itemResult = { id: "item-123", status: "pending_purchase", worksiteId: "ws-faena-1" }
    mockState.orderLinkResult = { id: "oc-link-999" }

    const result = await postponeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(false)
    expect(result.message).toBe("No se puede postergar un ítem que ya está en una OC")
  })

  // ── Service-layer error handling ──────────────────────────────────────────

  it("returns error message when postponeItem service throws", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ worksiteIds: ["ws-faena-1"] }))
    mockState.itemResult = { id: "item-123", status: "approved", worksiteId: "ws-faena-1" }
    mockState.orderLinkResult = null
    mockPostponeItem.mockRejectedValueOnce(new Error("Estado inválido para postergar"))

    const result = await postponeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(false)
    expect(result.message).toBe("Estado inválido para postergar")
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  it("calls postponeItem with correct arguments on success", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ worksiteIds: ["ws-faena-1"] }))
    mockState.itemResult = { id: "item-123", status: "approved", worksiteId: "ws-faena-1" }
    mockState.orderLinkResult = null

    const result = await postponeItemAction({ ok: false, message: "" }, makeFormData())

    expect(result.ok).toBe(true)
    expect(result.message).toBe("Ítem postergado")
    expect(mockPostponeItem).toHaveBeenCalledWith(
      "item-123",
      "u-test",
      "Reprogramado para la próxima temporada",
      { userEmail: "test@chome.cl" },
    )
  })

  it("passes userEmail as undefined when session has no email", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ worksiteIds: ["ws-faena-1"], email: undefined }))
    mockState.itemResult = { id: "item-123", status: "approved", worksiteId: "ws-faena-1" }
    mockState.orderLinkResult = null

    await postponeItemAction({ ok: false, message: "" }, makeFormData())

    expect(mockPostponeItem).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      { userEmail: undefined },
    )
  })
})

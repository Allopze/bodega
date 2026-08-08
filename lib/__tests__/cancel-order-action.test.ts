/**
 * Unit tests for cancelOrderAction — access control, validation, and execution.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"
import { cancelOrderAction } from "@/app/(app)/compras/actions"

// ── Hoisted mutable state: controls mock DB response ───────────────────────────
const mockState = vi.hoisted(() => ({
  orderResult: undefined as { id: string; code: string; worksiteId: string; status: string } | undefined,
}))

const mockAuthFn = vi.hoisted(() => vi.fn())

// ── Module Mocks ───────────────────────────────────────────────────────────────
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))

vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseOrders: {
        findFirst: vi.fn(() => mockState.orderResult),
      },
    },
  },
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const mockCancelOrder = vi.hoisted(() => vi.fn())
vi.mock("@/lib/services/purchasing", () => ({
  createOrdersBySupplier: vi.fn(),
  issueAndSendOrder: vi.fn(),
  cancelOrder: mockCancelOrder,
}))

describe("cancelOrderAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.orderResult = undefined
  })

  it("returns error if user is not authenticated or lacks permission", async () => {
    mockAuthFn.mockResolvedValueOnce(null) // Not logged in

    const formData = new FormData()
    formData.append("orderId", "oc-123")
    formData.append("reason", "Error de digitacion")

    const res = await cancelOrderAction({ ok: false, message: "" }, formData)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
    expect(mockCancelOrder).not.toHaveBeenCalled()
  })

  it("returns error if orderId is missing", async () => {
    mockAuthFn.mockResolvedValueOnce({
      user: {
        id: "usr-admin",
        permissions: ["purchasing:create_order"],
      },
    } as Session)

    const formData = new FormData()
    formData.append("reason", "Duplicado")

    const res = await cancelOrderAction({ ok: false, message: "" }, formData)
    expect(res.ok).toBe(false)
    expect(res.message).toBe("Orden no especificada")
  })

  it("returns error if reason is missing", async () => {
    mockAuthFn.mockResolvedValueOnce({
      user: {
        id: "usr-admin",
        permissions: ["purchasing:create_order"],
      },
    } as Session)

    const formData = new FormData()
    formData.append("orderId", "oc-123")

    const res = await cancelOrderAction({ ok: false, message: "" }, formData)
    expect(res.ok).toBe(false)
    expect(res.message).toBe("El motivo de anulación es obligatorio")
  })

  it("returns error if order is not found", async () => {
    mockAuthFn.mockResolvedValueOnce({
      user: {
        id: "usr-admin",
        permissions: ["purchasing:create_order"],
      },
    } as Session)
    mockState.orderResult = undefined

    const formData = new FormData()
    formData.append("orderId", "oc-nonexistent")
    formData.append("reason", "Cancelado")

    const res = await cancelOrderAction({ ok: false, message: "" }, formData)
    expect(res.ok).toBe(false)
    expect(res.message).toBe("Orden no encontrada")
  })

  it("returns error if user has no access to the worksite", async () => {
    mockAuthFn.mockResolvedValueOnce({
      user: {
        id: "usr-req",
        permissions: ["purchasing:create_order"],
        worksiteIds: ["ws-allowed"],
      },
    } as unknown as Session)

    mockState.orderResult = {
      id: "oc-123",
      code: "OC-2026-0001",
      worksiteId: "ws-restricted", // Not in worksiteIds
      status: "draft",
    }

    const formData = new FormData()
    formData.append("orderId", "oc-123")
    formData.append("reason", "Cancelado")

    const res = await cancelOrderAction({ ok: false, message: "" }, formData)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes acceso")
  })

  it("calls cancelOrder service on success", async () => {
    mockAuthFn.mockResolvedValueOnce({
      user: {
        id: "usr-admin",
        email: "admin@chome.cl",
        permissions: ["purchasing:create_order"],
        worksiteIds: ["ws-1"],
      },
    } as unknown as Session)

    mockState.orderResult = {
      id: "oc-123",
      code: "OC-2026-0001",
      worksiteId: "ws-1",
      status: "sent",
    }

    const formData = new FormData()
    formData.append("orderId", "oc-123")
    formData.append("reason", "OC obsoleta")

    const res = await cancelOrderAction({ ok: false, message: "" }, formData)
    expect(res.ok).toBe(true)
    expect(res.message).toContain("anulada correctamente")
    expect(mockCancelOrder).toHaveBeenCalledWith(
      "oc-123",
      "usr-admin",
      "OC obsoleta",
      ["ws-1"],
      { userEmail: "admin@chome.cl" },
    )
  })
})

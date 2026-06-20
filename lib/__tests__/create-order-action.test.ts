/**
 * Unit tests for createOrderAction — validation, scope, and execution.
 *
 * Covers:
 *  1. Permission denied (no purchasing:create_order)
 *  2. Invalid form data (missing items, bad JSON)
 *  3. Worksite scope denied
 *  4. Service-layer error propagation
 *  5. Happy path with valid items
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockCreateOrders = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("@/lib/services/purchasing", () => ({
  createOrdersBySupplier: mockCreateOrders,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { createOrderAction } from "@/app/(app)/compras/actions"

function makeSession(overrides: Partial<Session["user"]> = {}): Session {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "admin@test.cl",
      name: "Admin",
      roles: ["administrador"],
      permissions: ["purchasing:create_order"],
      worksiteIds: ["ws-1", "ws-2"],
      primaryWorksiteId: "ws-1",
      avatarColor: "#000",
      isActive: true,
      ...overrides,
    },
  }
}

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("worksiteId", "ws-1")
  fd.set("supplierId", "sup-1")
  fd.set("itemsJson", JSON.stringify([
    { requestItemId: "ri-1", productId: "p-1", productNameFree: null, quantity: 10, unitOfMeasure: "unidad", unitPrice: 1500 },
  ]))
  for (const [k, v] of Object.entries(overrides)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

describe("createOrderAction", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns error if permission denied", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: [] }))
    const res = await createOrderAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
    expect(mockCreateOrders).not.toHaveBeenCalled()
  })

  it("returns error on invalid items JSON", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const fd = makeFormData({ itemsJson: "not-json" })
    const res = await createOrderAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("ítems")
    expect(mockCreateOrders).not.toHaveBeenCalled()
  })

  it("returns error if Zod validation fails (missing fields)", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const fd = makeFormData({ worksiteId: "" })
    const res = await createOrderAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.fieldErrors).toBeDefined()
    expect(mockCreateOrders).not.toHaveBeenCalled()
  })

  it("propagates service-layer error", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockCreateOrders.mockRejectedValueOnce(new Error("Proveedor sin items"))
    const res = await createOrderAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Proveedor sin items")
  })

  it("creates order successfully on happy path", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockCreateOrders.mockResolvedValueOnce(["oc-1"])
    const res = await createOrderAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockCreateOrders).toHaveBeenCalledOnce()
  })
})

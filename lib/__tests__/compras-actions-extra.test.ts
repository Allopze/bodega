/**
 * Additional unit tests for compras Server Actions (coverage 49.04% → now covered).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockAssertOrderAccess = vi.hoisted(() => vi.fn(() => null))
const mockCanAccessWorksite = vi.hoisted(() => vi.fn(() => true))
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn(() => ({ mode: "all" as const, ids: [] })))

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  canAccessWorksite: mockCanAccessWorksite,
}))
vi.mock("@/lib/auth/scope", () => ({
  resolveWorksiteScope: mockResolveWorksiteScope,
}))
vi.mock("@/db", () => {
  const purchaseOrdersQuery = {
    findFirst: vi.fn(),
    findMany: vi.fn(() => []),
  }
  const db = {
    query: {
      purchaseOrders: purchaseOrdersQuery,
      purchaseOrderItems: { findFirst: vi.fn(), findMany: vi.fn(() => []) },
      purchaseRequestItems: { findMany: vi.fn(() => []) },
      suppliers: { findMany: vi.fn(() => [{ id: "sup-1", isActive: true }]) },
      worksites: { findFirst: vi.fn() },
    },
    select: vi.fn(() => ({ from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({ where: vi.fn(() => ({
        then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([{ code: "OC-001", worksiteName: "Faena", supplierName: "Prov", n: 3 }])),
      })) })),
    })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    delete: vi.fn(() => ({ where: vi.fn() })),
    transaction: vi.fn(async <T,>(fn: (tx: typeof db) => T): Promise<T> => fn(db)),
  }
  return { db }
})
vi.mock("@/lib/services/purchasing", () => ({
  markOrderSent: vi.fn(),
  cancelOrder: vi.fn(),
  closeOrder: vi.fn(),
  deleteOrder: vi.fn(),
  isOrderDeletable: vi.fn(() => true),
}))
vi.mock("@/lib/services/notifications", () => ({
  getUserIdsWithPermission: vi.fn(() => Promise.resolve([])),
  notifyManyUser: vi.fn(),
  notifyAfterCommit: vi.fn((fn: () => unknown) => fn()),
}))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT") }) }))
vi.mock("@/app/(app)/compras/actions.helpers", () => ({

  assertOrderAccess: mockAssertOrderAccess,
}))

import { sendOrderAction, cancelOrderAction, closeOrderAction, deleteOrderAction, createOrderAction } from "@/app/(app)/compras/actions"
import type { ActionState } from "@/lib/validation/operations"

const prevState: ActionState = { ok: false, message: "" }

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1", email: "admin@test.cl", name: "Admin",
      roles: ["administrador"],
      permissions: ["purchasing:send_order", "purchasing:create_order", "purchasing:delete_order"],
      worksiteIds: ["ws-1"], primaryWorksiteId: "ws-1",
      avatarColor: "#000", isActive: true,
    },
  }
}

describe("sendOrderAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
    mockAssertOrderAccess.mockReturnValue(null)
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const fd = new FormData()
    fd.set("orderId", "oc-1")
    const res = await sendOrderAction(prevState, fd)
    expect(res.ok).toBe(false)
  })

  it("returns error if orderId missing", async () => {
    const fd = new FormData()
    const res = await sendOrderAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Orden no especificada")
  })
})

describe("cancelOrderAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
    mockAssertOrderAccess.mockReturnValue(null)
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const fd = new FormData()
    fd.set("orderId", "oc-1")
    fd.set("reason", "test")
    const res = await cancelOrderAction(prevState, fd)
    expect(res.ok).toBe(false)
  })

  it("returns error if reason missing", async () => {
    const fd = new FormData()
    fd.set("orderId", "oc-1")
    const res = await cancelOrderAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("obligatorio")
  })

  it("cancels order successfully", async () => {
    const fd = new FormData()
    fd.set("orderId", "oc-1")
    fd.set("reason", "Duplicada")
    const res = await cancelOrderAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(res.message).toContain("anulada")
  })
})

describe("closeOrderAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
    mockAssertOrderAccess.mockReturnValue(null)
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const fd = new FormData()
    fd.set("orderId", "oc-1")
    fd.set("reason", "cancel")
    const res = await closeOrderAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if reason missing", async () => {
    const fd = new FormData()
    fd.set("orderId", "oc-1")
    const res = await closeOrderAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("obligatorio")
  })
})

describe("deleteOrderAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
    mockAssertOrderAccess.mockReturnValue(null)
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const fd = new FormData()
    fd.set("orderId", "oc-1")
    const res = await deleteOrderAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if orderId missing", async () => {
    const fd = new FormData()
    const res = await deleteOrderAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Orden no especificada")
  })
})

describe("createOrderAction delivery-mode mixing guard", () => {
  beforeEach(() => {
    mockRequirePermission.mockResolvedValue({
      user: { id: "u1", email: "a@b.cl", roles: ["administrador"], worksiteIds: ["ws-1"] },
    })
    mockCanAccessWorksite.mockReturnValue(true)
  })

  it("rejects an OC mixing via_oficina and directo_faena items", async () => {
    const { db } = await import("@/db")
    ;(db.query.purchaseRequestItems.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "ri-1", status: "approved", quantity: 2, unitOfMeasure: "unidad",
        request: { worksiteId: "ws-1", deliveryMode: "via_oficina" } },
      { id: "ri-2", status: "approved", quantity: 2, unitOfMeasure: "unidad",
        request: { worksiteId: "ws-1", deliveryMode: "directo_faena" } },
    ])

    const fd = new FormData()
    fd.set("worksiteId", "ws-1")
    fd.set("supplierId", "sup-1")
    fd.set("itemsJson", JSON.stringify([
      { requestItemId: "ri-1", quantity: 2, unitOfMeasure: "unidad", unitPrice: 100, supplierId: "sup-1" },
      { requestItemId: "ri-2", quantity: 2, unitOfMeasure: "unidad", unitPrice: 100, supplierId: "sup-1" },
    ]))

    const res = await createOrderAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/modo de despacho distinto/i)
  })
})

/**
 * Additional unit tests for compras Server Actions (coverage 49.04% → now covered).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockAssertOrderAccess = vi.hoisted(() => vi.fn(() => null))
const mockCanAccessWorksite = vi.hoisted(() => vi.fn(() => true))
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn((_session?: unknown) => ({ mode: "all" as const, ids: [] })))

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  canAccessWorksite: mockCanAccessWorksite,
}))
vi.mock("@/lib/auth/scope", () => ({
  resolveWorksiteScope: mockResolveWorksiteScope,
  serviceWorksiteScope: (session: unknown) => {
    const scope = mockResolveWorksiteScope(session)
    return scope.mode === "all" ? "all" : scope.ids
  },
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
  issueAndSendOrder: vi.fn(),
  cancelOrder: vi.fn(),
  closeOrder: vi.fn(),
  deleteOrder: vi.fn(),
  isOrderDeletable: vi.fn(() => true),
  reconcileOrderInvoices: vi.fn(),
}))
vi.mock("@/lib/services/notifications", () => ({
  getUserIdsWithPermission: vi.fn(() => Promise.resolve([])),
  notifyManyUser: vi.fn(),
  notifyAfterCommit: vi.fn((fn: () => unknown) => fn()),
}))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT") }) }))
vi.mock("@/app/(app)/compras/actions.helpers", () => ({

  assertOrderAccess: mockAssertOrderAccess,
}))

import { issueAndSendOrderAction, cancelOrderAction, closeOrderAction, deleteOrderAction, createOrderAction } from "@/app/(app)/compras/actions"
import { db } from "@/db"
import * as purchasing from "@/lib/services/purchasing"
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

describe("issueAndSendOrderAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
    mockAssertOrderAccess.mockReturnValue(null)
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const fd = new FormData()
    fd.set("orderId", "oc-1")
    const res = await issueAndSendOrderAction(prevState, fd)
    expect(res.ok).toBe(false)
  })

  it("returns error if orderId missing", async () => {
    const fd = new FormData()
    const res = await issueAndSendOrderAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Orden no especificada")
  })

  /**
   * `vi.resetAllMocks()` vacía también el `db.select` de la factory, y las
   * pruebas de arriba nunca llegan a la consulta. Estas sí: la acción lee el
   * resumen de la OC y el conteo de ítems antes de emitir.
   */
  function stubOrderSummaryQueries() {
    const chain = (rows: unknown[]) => {
      const link: Record<string, unknown> = {}
      link.from = () => link
      link.innerJoin = () => link
      link.where = () => link
      link.then = (onOk: (v: unknown) => unknown) => Promise.resolve(rows).then(onOk)
      return link
    }
    let call = 0
    vi.mocked(db.select).mockImplementation((() => (call++ === 0
      ? chain([{ code: "OC-001", worksiteName: "Faena", supplierName: "Prov" }])
      : chain([{ n: 3 }]))) as never)
  }

  /*
   * OC-002 (auditoría 2026-09-14): el aviso a Recepción decía siempre "ítems
   * enviados al proveedor X" aunque la plataforma no despacha nada por sí
   * misma. Recepción abría la cola de una OC que el proveedor podía no
   * conocer, y nadie podía distinguirlo de un despacho real.
   */
  it("no afirma a Recepción que la OC salió cuando no hay constancia ni contacto", async () => {
    vi.mocked(purchasing.issueAndSendOrder).mockResolvedValue({
      sentTo: null, evidence: null, hasDispatchEvidence: false,
      summary: "Emitida sin constancia de envío: Prov no tiene contacto registrado",
    })
    stubOrderSummaryQueries()
    const fd = new FormData()
    fd.set("orderId", "oc-1")

    await expect(issueAndSendOrderAction(prevState, fd)).rejects.toThrow("NEXT_REDIRECT")

    const { notifyManyUser } = await import("@/lib/services/notifications")
    expect(notifyManyUser).toHaveBeenCalledWith([], expect.objectContaining({
      body: expect.stringContaining("sin constancia de envío"),
    }))
    expect(vi.mocked(notifyManyUser).mock.calls[0]![1].body).not.toMatch(/enviados al proveedor/)
  })

  it("traslada la constancia declarada al aviso de Recepción", async () => {
    vi.mocked(purchasing.issueAndSendOrder).mockResolvedValue({
      sentTo: "ventas@prov.cl", evidence: "Correo 4821 con acuse",
      hasDispatchEvidence: true, summary: "Enviada a Prov (ventas@prov.cl). Constancia: Correo 4821 con acuse",
    })
    stubOrderSummaryQueries()
    const fd = new FormData()
    fd.set("orderId", "oc-1")
    fd.set("constanciaEnvio", "  Correo 4821 con acuse  ")

    await expect(issueAndSendOrderAction(prevState, fd)).rejects.toThrow("NEXT_REDIRECT")

    expect(purchasing.issueAndSendOrder).toHaveBeenCalledWith(
      "oc-1", "user-1", "all",
      expect.objectContaining({ dispatchEvidence: "Correo 4821 con acuse" }),
    )
    const { notifyManyUser } = await import("@/lib/services/notifications")
    expect(vi.mocked(notifyManyUser).mock.calls[0]![1].body).toContain("Correo 4821 con acuse")
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

  // Cerrar sin factura conciliada deja la OC sin respaldo: sigue siendo posible
  // —hay cierres legítimos sin factura— pero exige confirmarlo, y la
  // confirmación queda en el motivo que guarda el historial.
  it("no cierra una orden sin conciliar mientras no se confirme", async () => {
    vi.mocked(purchasing.reconcileOrderInvoices).mockResolvedValue({
      warnings: ["No hay facturas adjuntadas a esta orden."],
      hasInvoices: false, totalInvoiced: 0, totalOC: 11900, items: [], uncoveredItems: [],
    } as unknown as Awaited<ReturnType<typeof purchasing.reconcileOrderInvoices>>)

    const fd = new FormData()
    fd.set("orderId", "oc-1")
    fd.set("reason", "Acuerdo con proveedor")
    const res = await closeOrderAction(prevState, fd)

    expect(res.ok).toBe(false)
    expect(res.message).toContain("Marca la confirmación para cerrarla igual")
    expect(purchasing.closeOrder).not.toHaveBeenCalled()
  })

  it("cierra con la confirmación y deja rastro en el motivo", async () => {
    vi.mocked(purchasing.reconcileOrderInvoices).mockResolvedValue({
      warnings: ["No hay facturas adjuntadas a esta orden."],
      hasInvoices: false, totalInvoiced: 0, totalOC: 11900, items: [], uncoveredItems: [],
    } as unknown as Awaited<ReturnType<typeof purchasing.reconcileOrderInvoices>>)

    const fd = new FormData()
    fd.set("orderId", "oc-1")
    fd.set("reason", "Acuerdo con proveedor")
    fd.set("acknowledgeInvoiceWarnings", "true")
    const res = await closeOrderAction(prevState, fd)

    expect(res.ok).toBe(true)
    expect(purchasing.closeOrder).toHaveBeenCalledWith(
      "oc-1",
      expect.any(String),
      expect.stringContaining("Cierre sin conciliación de factura confirmado"),
      expect.anything(),
      expect.anything(),
    )
  })

  it("no pide confirmación cuando la facturación cuadra", async () => {
    vi.mocked(purchasing.reconcileOrderInvoices).mockResolvedValue({
      warnings: [], hasInvoices: true, totalInvoiced: 11900, totalOC: 11900, items: [], uncoveredItems: [],
    } as unknown as Awaited<ReturnType<typeof purchasing.reconcileOrderInvoices>>)

    const fd = new FormData()
    fd.set("orderId", "oc-1")
    fd.set("reason", "Recepción completa")
    const res = await closeOrderAction(prevState, fd)

    expect(res.ok).toBe(true)
    expect(purchasing.closeOrder).toHaveBeenCalledWith(
      "oc-1", expect.any(String), "Recepción completa", expect.anything(), expect.anything(),
    )
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

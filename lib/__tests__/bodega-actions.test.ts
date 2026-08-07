/**
 * Unit tests for bodega actions — dispatch, setMinStock, adjustStock, returnStock.
 *
 * Covers:
 *  1. Permission denied for each action
 *  2. Validation errors
 *  3. Worksite scope denied
 *  4. Service-layer error propagation
 *  5. Happy paths
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockRegisterStockAdjustment = vi.hoisted(() => vi.fn())
const mockRegisterStockReturn = vi.hoisted(() => vi.fn())
const mockRegisterWorksiteDelivery = vi.hoisted(() => vi.fn())
const mockClosePhysicalInventoryCount = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/services/stock", () => ({
  registerStockAdjustment: mockRegisterStockAdjustment,
  registerStockReturn: mockRegisterStockReturn,
}))
vi.mock("@/lib/services/deliveries", () => ({
  registerWorksiteDelivery: mockRegisterWorksiteDelivery,
}))
vi.mock("@/lib/services/physical-inventory", () => ({
  closePhysicalInventoryCount: mockClosePhysicalInventoryCount,
}))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))

const mockDb = {
  query: { worksiteStock: { findFirst: vi.fn() } },
  select: vi.fn(),
  update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
  transaction: vi.fn(),
}

vi.mock("@/db", () => ({ db: mockDb }))

function makeSession(perm: string, worksiteIds: string[] = ["ws-1"]): Session {
  return {
    user: {
      id: "user-1",
      name: "Bodeguero",
      email: "bodega@chome.cl",
      permissions: [perm],
      roles: ["bodeguero"],
      worksiteIds,
      isGlobal: false,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as unknown as Session
}

describe("bodega actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRegisterStockAdjustment.mockResolvedValue({ id: "adjustment-1", code: "AJU-2026-0001" })
    mockRegisterStockReturn.mockResolvedValue({ id: "return-1", code: "DEV-2026-0001" })
    mockRegisterWorksiteDelivery.mockResolvedValue(undefined)
    mockClosePhysicalInventoryCount.mockResolvedValue({ id: "count-1", code: "CON-2026-0001", adjustmentCount: 2 })
    mockDb.query.worksiteStock.findFirst.mockResolvedValue(null)
    mockDb.transaction.mockImplementation(async (fn) => fn({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn().mockResolvedValue([{ id: "stock-1", worksiteId: "ws-1", minStock: 2 }]),
          })),
        })),
      })),
      update: mockDb.update,
    }))

    // Default select chain for returnStock prior movements
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      then: (resolve: (v: unknown[]) => void) => Promise.resolve([]).then(resolve),
    }
    mockDb.select.mockReturnValue(selectChain)
  })

  // ── dispatchAction ──────────────────────────────────────────────────────

  describe("dispatchAction", () => {
    it("denies without warehouse:register_movement", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { dispatchAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("quantity", "5")
      fd.set("unitOfMeasure", "unidad")
      fd.set("receiverName", "Juan")
      const result = await dispatchAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Sin permisos")
    })

    it("rejects invalid quantity", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:register_movement"))
      const { dispatchAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("quantity", "0")
      fd.set("unitOfMeasure", "unidad")
      fd.set("receiverName", "Juan")
      const result = await dispatchAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.fieldErrors).toBeDefined()
    })

    it("denies access to worksite outside scope", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:register_movement", ["ws-1"]))
      const { dispatchAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-other")
      fd.set("productId", "prod-1")
      fd.set("quantity", "5")
      fd.set("unitOfMeasure", "unidad")
      fd.set("receiverName", "Juan")
      const result = await dispatchAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("No tienes acceso")
    })

    it("registers delivery on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:register_movement", ["ws-1"]))
      const { dispatchAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("quantity", "5")
      fd.set("unitOfMeasure", "unidad")
      fd.set("receiverName", "Juan Pérez")
      fd.set("notes", "Entrega turno mañana")
      const result = await dispatchAction({ ok: false }, fd)
      expect(result.ok).toBe(true)
      expect(result.message).toContain("Entrega registrada")
      expect(mockRegisterWorksiteDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ worksiteId: "ws-1", productId: "prod-1", quantity: 5 }),
        expect.anything(),
      )
    })

    it("propagates service error", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:register_movement", ["ws-1"]))
      mockRegisterWorksiteDelivery.mockRejectedValue(new Error("Stock insuficiente"))
      const { dispatchAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("quantity", "5")
      fd.set("unitOfMeasure", "unidad")
      fd.set("receiverName", "Juan")
      const result = await dispatchAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Stock insuficiente")
    })
  })

  // ── setMinStockAction ───────────────────────────────────────────────────

  describe("setMinStockAction", () => {
    it("denies without warehouse:register_movement", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { setMinStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("stockId", "stock-1")
      fd.set("minStock", "10")
      const result = await setMinStockAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Sin permisos")
    })

    it("returns error when stock not found", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:register_movement"))
      mockDb.query.worksiteStock.findFirst.mockResolvedValue(null)
      const { setMinStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("stockId", "nonexistent")
      fd.set("minStock", "10")
      const result = await setMinStockAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Stock no encontrado")
    })

    it("denies access to stock in different worksite", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:register_movement", ["ws-1"]))
      mockDb.query.worksiteStock.findFirst.mockResolvedValue({ id: "stock-1", worksiteId: "ws-other" })
      const { setMinStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("stockId", "stock-1")
      fd.set("minStock", "10")
      const result = await setMinStockAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("No tienes acceso")
    })

    it("updates min stock on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:register_movement", ["ws-1"]))
      mockDb.query.worksiteStock.findFirst.mockResolvedValue({ id: "stock-1", worksiteId: "ws-1" })
      const { setMinStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("stockId", "stock-1")
      fd.set("minStock", "10")
      const result = await setMinStockAction({ ok: false }, fd)
      expect(result.ok).toBe(true)
      expect(result.message).toContain("Stock mínimo actualizado")
      expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
        entityType: "worksite_stock",
        oldState: { minStock: 2 },
        newState: { minStock: 10 },
      }), expect.anything())
    })
  })

  // ── adjustStockAction ───────────────────────────────────────────────────

  describe("adjustStockAction", () => {
    it("denies without warehouse:adjust_stock", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:register_movement"))
      const { adjustStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("quantity", "5")
      fd.set("direction", "ingreso")
      fd.set("reason", "Corrección")
      const result = await adjustStockAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Sin permisos")
    })

    it("denies access to worksite outside scope", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      const { adjustStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-other")
      fd.set("productId", "prod-1")
      fd.set("quantity", "5")
      fd.set("direction", "ingreso")
      fd.set("reason", "Corrección")
      const result = await adjustStockAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("No tienes acceso")
    })

    it("registers positive adjustment (ingreso)", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      const { adjustStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("quantity", "3")
      fd.set("direction", "ingreso")
      fd.set("reason", "Sobrante")
      const result = await adjustStockAction({ ok: false }, fd)
      expect(result.ok).toBe(true)
      expect(result.message).toContain("+3")
      expect(mockRegisterStockAdjustment).toHaveBeenCalledWith(expect.objectContaining({
        type: "ajuste",
        quantity: 3,
      }))
    })

    it("registers negative adjustment (egreso)", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      const { adjustStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("quantity", "2")
      fd.set("direction", "egreso")
      fd.set("reason", "Faltante")
      const result = await adjustStockAction({ ok: false }, fd)
      expect(result.ok).toBe(true)
      expect(result.message).toContain("-2")
      expect(mockRegisterStockAdjustment).toHaveBeenCalledWith(expect.objectContaining({
        type: "ajuste",
        quantity: -2,
      }))
    })

    it("propagates service error", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      mockRegisterStockAdjustment.mockRejectedValue(new Error("Stock insuficiente"))
      const { adjustStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("quantity", "999")
      fd.set("direction", "egreso")
      fd.set("reason", "Test")
      const result = await adjustStockAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Stock insuficiente")
    })
  })

  // ── returnStockAction ──────────────────────────────────────────────────

  describe("returnStockAction", () => {
    it("uses only the selected delivery item; the service derives product and worksite under lock", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:register_movement", ["ws-1"]))
      const { returnStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("deliveryItemId", "delivery-item-1")
      fd.set("worksiteId", "ws-forged")
      fd.set("productId", "prod-forged")
      fd.set("quantity", "2")
      fd.set("reason", "Sobrante")

      const result = await returnStockAction({ ok: false }, fd)

      expect(result.ok).toBe(true)
      expect(mockRegisterStockReturn).toHaveBeenCalledWith({
        deliveryItemId: "delivery-item-1",
        quantity: 2,
        performedBy: "user-1",
        userEmail: "bodega@chome.cl",
        reason: "Sobrante",
        notes: undefined,
      }, ["ws-1"])
    })

    it("rejects a return without a delivery source", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:register_movement"))
      const { returnStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("quantity", "2")
      fd.set("reason", "Sobrante")

      const result = await returnStockAction({ ok: false }, fd)

      expect(result.ok).toBe(false)
      expect(result.fieldErrors?.deliveryItemId).toBeDefined()
      expect(mockRegisterStockReturn).not.toHaveBeenCalled()
    })
  })

  // ── closePhysicalInventoryCountAction ──────────────────────────────────

  describe("closePhysicalInventoryCountAction", () => {
    it("denies without warehouse:adjust_stock", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:register_movement"))
      const { closePhysicalInventoryCountAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      const result = await closePhysicalInventoryCountAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Sin permisos")
    })

    it("rejects when no counted products are submitted", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      const { closePhysicalInventoryCountAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      const result = await closePhysicalInventoryCountAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Agrega")
    })

    it("ignora las filas que el usuario no contó (no ajusta el catálogo completo)", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      const { closePhysicalInventoryCountAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      // El formulario envía una fila por producto de la faena; sólo la segunda fue contada.
      for (const productId of ["prod-1", "prod-2", "prod-3"]) fd.append("countProductId", productId)
      for (const counted of ["", "7", "  "]) fd.append("countedQuantity", counted)
      for (const note of ["", "", ""]) fd.append("itemNotes", note)

      const result = await closePhysicalInventoryCountAction({ ok: false }, fd)

      expect(result.ok).toBe(true)
      expect(mockClosePhysicalInventoryCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          items: [{ productId: "prod-2", countedQuantity: 7, notes: "" }],
        }),
        ["ws-1"],
      )
    })

    it("closes a physical inventory count on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      const { closePhysicalInventoryCountAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("notes", "Conteo mensual")
      fd.append("countProductId", "prod-1")
      fd.append("expectedQuantity", "999999") // El cliente no es fuente de saldo.
      fd.append("countedQuantity", "8")
      fd.append("itemNotes", "Faltan 2")
      fd.append("countProductId", "prod-2")
      fd.append("expectedQuantity", "999999")
      fd.append("countedQuantity", "5")
      fd.append("itemNotes", "")

      const result = await closePhysicalInventoryCountAction({ ok: false }, fd)

      expect(result.ok).toBe(true)
      expect(result.message).toContain("CON-2026-0001")
      expect(mockClosePhysicalInventoryCount).toHaveBeenCalledWith(
        expect.objectContaining({ user: expect.objectContaining({ id: "user-1" }) }),
        {
          worksiteId: "ws-1",
          notes: "Conteo mensual",
          items: [
            { productId: "prod-1", countedQuantity: 8, notes: "Faltan 2" },
            { productId: "prod-2", countedQuantity: 5, notes: "" },
          ],
        },
        ["ws-1"],
      )
    })
  })
})

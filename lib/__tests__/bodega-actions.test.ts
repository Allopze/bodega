/**
 * Unit tests for bodega actions — adjustStock and returnStock.
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
const mockRegisterStockDocumentTx = vi.hoisted(() => vi.fn())
const mockCurrentStock = vi.hoisted(() => ({ rows: [{ quantity: 4 }] as Array<{ quantity: number }> }))
const mockRegisterStockReturn = vi.hoisted(() => vi.fn())
const mockClosePhysicalInventoryCount = vi.hoisted(() => vi.fn())

// El guard de módulo consulta `system_settings` en cada verificación de permiso
// (CO-007). Estas pruebas mockean sólo las tablas de su caso, así que se
// declara aquí que ningún módulo está apagado; el guard tiene sus propias
// regresiones en lib/__tests__/module-toggles.test.ts.
vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
  getNavigationToggleState: vi.fn(async () => ({ enabledModuleIds: new Set<string>(), disabledSubmoduleHrefs: new Set<string>() })),
}))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/services/stock-movement", () => ({
  registerStockDocumentTx: mockRegisterStockDocumentTx,
}))
vi.mock("@/lib/services/stock", () => ({
  registerStockReturn: mockRegisterStockReturn,
}))
vi.mock("@/lib/services/physical-inventory", () => ({
  closePhysicalInventoryCount: mockClosePhysicalInventoryCount,
}))

const mockDb = {
  select: vi.fn(),
  // BOD-04: el ajuste lee el saldo bajo lock dentro de una transacción.
  transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
    select: () => ({
      from: () => ({
        where: () => ({ for: () => Promise.resolve(mockCurrentStock.rows) }),
      }),
    }),
  })),
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
    mockCurrentStock.rows = [{ quantity: 4 }]
    mockRegisterStockDocumentTx.mockResolvedValue({ id: "adjustment-1", code: "AJU-2026-0001" })
    mockRegisterStockReturn.mockResolvedValue({ id: "return-1", code: "DEV-2026-0001" })
    mockClosePhysicalInventoryCount.mockResolvedValue({ id: "count-1", code: "CON-2026-0001", adjustmentCount: 2 })
    // Default select chain for returnStock prior movements
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      then: (resolve: (v: unknown[]) => void) => Promise.resolve([]).then(resolve),
    }
    mockDb.select.mockReturnValue(selectChain)
  })

  // ── adjustStockAction ───────────────────────────────────────────────────

  describe("adjustStockAction", () => {
    it("denies without warehouse:adjust_stock", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:register_movement"))
      const { adjustStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("countedQuantity", "9")
      fd.set("reason", "Corrección de conteo")
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
      fd.set("countedQuantity", "9")
      fd.set("reason", "Corrección de conteo")
      const result = await adjustStockAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("No tienes acceso")
    })

    /**
     * STK-002 (auditoría 2026-09-14), patrón P6: el ajuste pedía **un**
     * carácter. Es la única operación que fija cualquier saldo sin documento de
     * origen y era la que menos explicación exigía de toda la plataforma —menos
     * que anular una entrega, que pide diez—.
     */
    it("no acepta un motivo de una palabra para escribir inventario a mano", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      const { adjustStockAction } = await import("@/app/(app)/bodega/actions")

      for (const reason of [".", "ok", "Sobrante"]) {
        const fd = new FormData()
        fd.set("worksiteId", "ws-1")
        fd.set("productId", "prod-1")
        fd.set("countedQuantity", "7")
        fd.set("reason", reason)
        const result = await adjustStockAction({ ok: false }, fd)
        expect(result.ok, `motivo «${reason}»`).toBe(false)
      }

      // Y no llegó a tocar el inventario en ninguno de los tres intentos.
      expect(mockRegisterStockDocumentTx).not.toHaveBeenCalled()
    })

    it("calcula el delta positivo contra el saldo bloqueado", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      const { adjustStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("countedQuantity", "7")
      fd.set("reason", "Sobrante detectado en conteo")
      const result = await adjustStockAction({ ok: false }, fd)
      expect(result.ok).toBe(true)
      expect(result.message).toContain("4 → 7 (+3)")
      expect(mockRegisterStockDocumentTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        kind: "ajuste",
        type: "ajuste",
        quantity: 3,
      }))
    })

    it("calcula el delta negativo contra el saldo bloqueado", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      const { adjustStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("countedQuantity", "2")
      fd.set("reason", "Faltante detectado en conteo")
      const result = await adjustStockAction({ ok: false }, fd)
      expect(result.ok).toBe(true)
      expect(result.message).toContain("4 → 2 (-2)")
      expect(mockRegisterStockDocumentTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        type: "ajuste",
        quantity: -2,
      }))
    })

    it("ignora cualquier delta que mande el cliente: manda la cantidad real", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      const { adjustStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("quantity", "99999")
      fd.set("direction", "egreso")
      fd.set("countedQuantity", "6")
      fd.set("reason", "Diferencia de conteo semanal")
      await adjustStockAction({ ok: false }, fd)
      expect(mockRegisterStockDocumentTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ quantity: 2 }))
    })

    it("rechaza la cantidad real negativa o en blanco (en blanco no es 0)", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      const { adjustStockAction } = await import("@/app/(app)/bodega/actions")
      for (const value of ["-1", "", "abc"]) {
        const fd = new FormData()
        fd.set("worksiteId", "ws-1")
        fd.set("productId", "prod-1")
        fd.set("countedQuantity", value)
        fd.set("reason", "Diferencia de conteo semanal")
        const result = await adjustStockAction({ ok: false }, fd)
        expect(result.ok, `valor «${value}»`).toBe(false)
      }
      expect(mockRegisterStockDocumentTx).not.toHaveBeenCalled()
    })

    it("no registra nada cuando la cantidad real iguala al saldo", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      const { adjustStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("countedQuantity", "4")
      fd.set("reason", "Diferencia de conteo semanal")
      const result = await adjustStockAction({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("nada que ajustar")
      expect(mockRegisterStockDocumentTx).not.toHaveBeenCalled()
    })

    it("propagates service error", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:adjust_stock", ["ws-1"]))
      mockRegisterStockDocumentTx.mockRejectedValue(new Error("Stock insuficiente"))
      const { adjustStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("worksiteId", "ws-1")
      fd.set("productId", "prod-1")
      fd.set("countedQuantity", "999")
      fd.set("reason", "Motivo de prueba")
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
      fd.set("reason", "Sobrante detectado en conteo")

      const result = await returnStockAction({ ok: false }, fd)

      expect(result.ok).toBe(true)
      expect(mockRegisterStockReturn).toHaveBeenCalledWith({
        deliveryItemId: "delivery-item-1",
        quantity: 2,
        performedBy: "user-1",
        userEmail: "bodega@chome.cl",
        reason: "Sobrante detectado en conteo",
        notes: undefined,
      }, ["ws-1"])
    })

    it("rejects a return without a delivery source", async () => {
      mockAuthFn.mockResolvedValue(makeSession("warehouse:register_movement"))
      const { returnStockAction } = await import("@/app/(app)/bodega/actions")
      const fd = new FormData()
      fd.set("quantity", "2")
      fd.set("reason", "Sobrante detectado en conteo")

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
          countId: null,
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

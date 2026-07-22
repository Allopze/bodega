import { describe, expect, it, vi } from "vitest"
import { applyMovementTx, type ApplyMovementInput } from "@/lib/services/stock-movement"

describe("Stock Movement Service (applyMovementTx)", () => {
  it("rejects movements for non-existent worksites", async () => {
    const mockTx: any = {
      query: {
        worksites: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    }

    const input: ApplyMovementInput = {
      worksiteId: "ws-999",
      productId: "prod-1",
      type: "ingreso_oc",
      quantity: 10,
      performedBy: "user-1",
    }

    await expect(applyMovementTx(mockTx, input)).rejects.toThrow("Worksite ws-999 not found")
  })

  it("rejects movements for inactive worksites", async () => {
    const mockTx: any = {
      query: {
        worksites: {
          findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Faena Inactiva", isActive: false }),
        },
      },
    }

    const input: ApplyMovementInput = {
      worksiteId: "ws-1",
      productId: "prod-1",
      type: "ingreso_oc",
      quantity: 10,
      performedBy: "user-1",
    }

    await expect(applyMovementTx(mockTx, input)).rejects.toThrow("Worksite 'Faena Inactiva' is not active")
  })

  it("requires a non-empty reason for manual adjustments", async () => {
    const mockTx: any = {
      query: {
        worksites: {
          findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Faena Centro", isActive: true }),
        },
      },
    }

    const input: ApplyMovementInput = {
      worksiteId: "ws-1",
      productId: "prod-1",
      type: "ajuste",
      quantity: 5,
      performedBy: "user-1",
      reason: "   ",
    }

    await expect(applyMovementTx(mockTx, input)).rejects.toThrow("El ajuste de inventario requiere un motivo")
  })

  it("rejects adjustment of zero quantity", async () => {
    const mockTx: any = {
      query: {
        worksites: {
          findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Faena Centro", isActive: true }),
        },
      },
    }

    const input: ApplyMovementInput = {
      worksiteId: "ws-1",
      productId: "prod-1",
      type: "ajuste",
      quantity: 0,
      performedBy: "user-1",
      reason: "Conteo físico",
    }

    await expect(applyMovementTx(mockTx, input)).rejects.toThrow("La cantidad de ajuste no puede ser cero")
  })

  it("rejects discard movement with zero or negative quantity", async () => {
    const mockTx: any = {
      query: {
        worksites: {
          findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Faena Centro", isActive: true }),
        },
      },
    }

    const input: ApplyMovementInput = {
      worksiteId: "ws-1",
      productId: "prod-1",
      type: "egreso_desecho",
      quantity: 0,
      performedBy: "user-1",
    }

    await expect(applyMovementTx(mockTx, input)).rejects.toThrow("La cantidad de un movimiento de desecho debe ser mayor que cero")
  })
})

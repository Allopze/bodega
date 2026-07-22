import { describe, expect, it } from "vitest"
import { closePhysicalInventoryCount } from "@/lib/services/physical-inventory"

describe("Physical Inventory Count Service (physical-inventory.ts)", () => {
  const dummySession: any = {
    user: { id: "user-1", email: "bodeguero@chome.cl" },
  }

  it("rejects inventory count without worksiteId", async () => {
    await expect(closePhysicalInventoryCount(dummySession, {
      worksiteId: "",
      items: [{ productId: "p-1", expectedQuantity: 10, countedQuantity: 10 }],
    }, "all")).rejects.toThrow("Faena requerida")
  })

  it("checks worksite scope permissions", async () => {
    await expect(closePhysicalInventoryCount(dummySession, {
      worksiteId: "ws-restringida",
      items: [{ productId: "p-1", expectedQuantity: 10, countedQuantity: 10 }],
    }, ["ws-permitida"])).rejects.toThrow("No tienes acceso a esta faena")
  })

  it("rejects inventory count with empty items array", async () => {
    await expect(closePhysicalInventoryCount(dummySession, {
      worksiteId: "ws-1",
      items: [],
    }, "all")).rejects.toThrow("Agrega al menos un producto al conteo")
  })

  it("rejects duplicate products in the same inventory count", async () => {
    await expect(closePhysicalInventoryCount(dummySession, {
      worksiteId: "ws-1",
      items: [
        { productId: "p-100", expectedQuantity: 5, countedQuantity: 5 },
        { productId: "p-100", expectedQuantity: 2, countedQuantity: 2 }, // Duplicado
      ],
    }, "all")).rejects.toThrow("El conteo no puede repetir productos")
  })

  it("rejects negative expected or counted quantities", async () => {
    await expect(closePhysicalInventoryCount(dummySession, {
      worksiteId: "ws-1",
      items: [
        { productId: "p-1", expectedQuantity: -5, countedQuantity: 10 },
      ],
    }, "all")).rejects.toThrow("Stock esperado debe ser un numero no negativo")
  })
})

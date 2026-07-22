import { describe, expect, it } from "vitest"
import { registerWorkerEppDelivery } from "@/lib/services/deliveries-worker-epp"

describe("Worker EPP Delivery Service (deliveries-worker-epp.ts)", () => {
  it("rejects delivery when worksite is empty", async () => {
    await expect(registerWorkerEppDelivery({
      worksiteId: "",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("Selecciona una faena")
  })

  it("rejects delivery when worker is empty", async () => {
    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("Selecciona un trabajador")
  })

  it("rejects delivery when quantity is zero or negative", async () => {
    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 0,
      deliveredBy: "u-1",
    })).rejects.toThrow("La cantidad debe ser mayor a 0")
  })

  it("checks worksite scope permissions", async () => {
    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-restringida",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    }, ["ws-permitida"])).rejects.toThrow("No tienes acceso a esta faena")
  })
})

/**
 * Unit tests for purchasing and stock validation schemas (Zod).
 * Tests input validation rules without requiring a database.
 */

import { describe, it, expect } from "vitest"
import { createOrderSchema, receiptSchema, workerDeliverySchema, setMinStockSchema, returnStockSchema } from "../validation/operations"

describe("Purchasing validation schemas", () => {
  describe("createOrderSchema", () => {
    const validInput = {
      worksiteId: "ws-1",
      supplierId: "sup-1",
      items: [{
        requestItemId: "ri-1",
        productId: "prod-1",
        productNameFree: null,
        quantity: 5,
        unitOfMeasure: "unidad",
        unitPrice: 1000,
      }],
    }

    it("accepts valid input", () => {
      expect(() => createOrderSchema.parse(validInput)).not.toThrow()
    })

    it("rejects empty items array", () => {
      expect(() => createOrderSchema.parse({ ...validInput, items: [] }))
        .toThrow()
    })

    it("rejects negative unitPrice", () => {
      expect(() => createOrderSchema.parse({
        ...validInput,
        items: [{ ...validInput.items[0], unitPrice: -1 }],
      })).toThrow()
    })

    it("rejects zero quantity", () => {
      expect(() => createOrderSchema.parse({
        ...validInput,
        items: [{ ...validInput.items[0], quantity: 0 }],
      })).toThrow()
    })

    it("rejects missing worksiteId", () => {
      expect(() => createOrderSchema.parse({ ...validInput, worksiteId: "" }))
        .toThrow()
    })

    it("accepts empty supplierId when items have their own supplier", () => {
      expect(() => createOrderSchema.parse({ ...validInput, supplierId: "" })).not.toThrow()
    })

    it("accepts free-text products (no productId)", () => {
      expect(() => createOrderSchema.parse({
        ...validInput,
        items: [{
          requestItemId: "ri-2",
          productId: null,
          productNameFree: "Producto libre",
          quantity: 3,
          unitOfMeasure: "caja",
          unitPrice: 500,
        }],
      })).not.toThrow()
    })
  })

  describe("receiptSchema", () => {
    const validInput = {
      purchaseOrderId: "oc-1",
      stage: "office" as const,
      worksiteId: "ws-1",
      items: [{
        purchaseOrderItemId: "oi-1",
        quantityReceived: 5,
      }],
    }

    it("accepts valid input", () => {
      expect(() => receiptSchema.parse(validInput)).not.toThrow()
    })

    it("rejects empty items", () => {
      expect(() => receiptSchema.parse({ ...validInput, items: [] })).toThrow()
    })

    it("rejects negative quantities", () => {
      expect(() => receiptSchema.parse({
        ...validInput,
        items: [{ ...validInput.items[0], quantityReceived: -1 }],
      })).toThrow()
    })

    it("rejects invalid stage", () => {
      expect(() => receiptSchema.parse({ ...validInput, stage: "invalid" }))
        .toThrow()
    })

    it("accepts 'faena' stage", () => {
      expect(() => receiptSchema.parse({ ...validInput, stage: "faena" }))
        .not.toThrow()
    })
  })
})

describe("Stock validation schemas", () => {
  describe("setMinStockSchema", () => {
    it("accepts valid input", () => {
      expect(() => setMinStockSchema.parse({
        stockId: "st-1",
        minStock: 10,
      })).not.toThrow()
    })

    it("rejects negative minStock", () => {
      expect(() => setMinStockSchema.parse({
        productId: "prod-1",
        worksiteId: "ws-1",
        minStock: -1,
      })).toThrow()
    })

    it("rejects missing stockId", () => {
      expect(() => setMinStockSchema.parse({
        stockId: "",
        minStock: 10,
      })).toThrow()
    })
  })

  describe("workerDeliverySchema", () => {
    it("accepts valid input", () => {
      expect(() => workerDeliverySchema.parse({
        worksiteId: "ws-1",
        workerId: "w-1",
        requestItemId: "ri-1",
        quantity: 2,
      })).not.toThrow()
    })

    it("rejects zero quantity", () => {
      expect(() => workerDeliverySchema.parse({
        worksiteId: "ws-1",
        workerId: "w-1",
        requestItemId: "ri-1",
        quantity: 0,
      })).toThrow()
    })
  })

  describe("returnStockSchema", () => {
    it("accepts valid input", () => {
      expect(() => returnStockSchema.parse({
        worksiteId: "ws-1",
        productId: "prod-1",
        quantity: 3,
        reason: "Devolución por error",
      })).not.toThrow()
    })

    it("rejects empty reason", () => {
      expect(() => returnStockSchema.parse({
        worksiteId: "ws-1",
        productId: "prod-1",
        quantity: 3,
        reason: "",
      })).toThrow()
    })

    it("rejects negative quantity", () => {
      expect(() => returnStockSchema.parse({
        worksiteId: "ws-1",
        productId: "prod-1",
        quantity: -1,
        reason: "test",
      })).toThrow()
    })
  })
})

import { describe, expect, it } from "vitest"
import {
  cancelRepuestoSchema,
  quotationUploadSchema,
  repuestoItemSchema,
  repuestoRequestSchema,
} from "@/lib/validation/repuestos"

const validRepuestoItem = {
  description: "Filtro hidraulico",
  quantity: 2,
}

describe("repuestoItemSchema", () => {
  it("accepts an item with description", () => {
    const result = repuestoItemSchema.parse(validRepuestoItem)

    expect(result.description).toBe("Filtro hidraulico")
    expect(result.quantity).toBe(2)
    expect(result.unitOfMeasure).toBe("unidad")
  })

  it("rejects quantity less than or equal to zero", () => {
    const result = repuestoItemSchema.safeParse({
      ...validRepuestoItem,
      quantity: 0,
    })

    expect(result.success).toBe(false)
  })
})

describe("repuestoRequestSchema", () => {
  it("accepts a request with at least one repuesto", () => {
    const result = repuestoRequestSchema.safeParse({
      worksiteId: "ws-1",
      requiredDate: "2026-06-30",
      items: [validRepuestoItem],
    })

    expect(result.success).toBe(true)
  })

  it("rejects requests without repuestos", () => {
    const result = repuestoRequestSchema.safeParse({
      worksiteId: "ws-1",
      requiredDate: "2026-06-30",
      items: [],
    })

    expect(result.success).toBe(false)
  })
})

describe("quotationUploadSchema", () => {
  it("accepts a non-negative amount", () => {
    const result = quotationUploadSchema.parse({
      requestId: "req-1",
      totalAmount: 125000,
    })

    expect(result.totalAmount).toBe(125000)
  })

  it("rejects a negative amount", () => {
    const result = quotationUploadSchema.safeParse({
      requestId: "req-1",
      totalAmount: -1,
    })

    expect(result.success).toBe(false)
  })
})

describe("cancelRepuestoSchema", () => {
  it("requires a non-empty reason", () => {
    const result = cancelRepuestoSchema.safeParse({
      requestId: "req-1",
      reason: "   ",
    })

    expect(result.success).toBe(false)
  })
})

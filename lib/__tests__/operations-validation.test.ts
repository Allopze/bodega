import { describe, expect, it } from "vitest"
import { createOrderSchema, dispatchSchema, receiptSchema, stockAdjustmentSchema } from "@/lib/validation/operations"

const validOrder = {
  worksiteId:        "worksite-1",
  supplierId:        "supplier-1",
  paymentTerms:      "",
  estimatedDelivery: "",
  deliveryAddress:   "",
  notes:             "",
  items: [
    {
      requestItemId:   "item-1",
      productId:       "product-1",
      productNameFree: null,
      quantity:        2,
      unitOfMeasure:   "unidad",
      unitPrice:       1500,
      discount:        10,
      notes:           "",
    },
  ],
}

describe("createOrderSchema", () => {
  it("accepts a complete purchase order payload", () => {
    const result = createOrderSchema.safeParse(validOrder)
    expect(result.success).toBe(true)
  })

  it("rejects non-finite prices and quantities", () => {
    const result = createOrderSchema.safeParse({
      ...validOrder,
      items: [{ ...validOrder.items[0], quantity: Number.POSITIVE_INFINITY, unitPrice: Number.NaN }],
    })

    expect(result.success).toBe(false)
  })

  it("rejects discounts outside the allowed percentage range", () => {
    expect(createOrderSchema.safeParse({
      ...validOrder,
      items: [{ ...validOrder.items[0], discount: -1 }],
    }).success).toBe(false)

    expect(createOrderSchema.safeParse({
      ...validOrder,
      items: [{ ...validOrder.items[0], discount: 101 }],
    }).success).toBe(false)
  })

  it("requires at least one order item", () => {
    expect(createOrderSchema.safeParse({ ...validOrder, items: [] }).success).toBe(false)
  })
})

describe("receiptSchema", () => {
  const validReceipt = {
    purchaseOrderId: "po-1",
    locationType: "faena",
    worksiteId: "worksite-1",
    warehouseId: "",
    dispatchGuideNo: "GD-38291",
    notes: "",
    items: [
      {
        purchaseOrderItemId: "poi-1",
        quantityReceived: 1,
        quantityRejected: 0,
        quantityDamaged: 0,
        notes: "",
      },
    ],
  }

  it("accepts a direct-to-worksite receipt", () => {
    expect(receiptSchema.safeParse(validReceipt).success).toBe(true)
  })

  it("requires a warehouse when receiving into warehouse stock", () => {
    expect(receiptSchema.safeParse({ ...validReceipt, locationType: "warehouse", warehouseId: "" }).success).toBe(false)
    expect(receiptSchema.safeParse({ ...validReceipt, locationType: "warehouse", warehouseId: "warehouse-1" }).success).toBe(true)
  })

  it("rejects negative and non-finite received quantities", () => {
    expect(receiptSchema.safeParse({
      ...validReceipt,
      items: [{ ...validReceipt.items[0], quantityReceived: -1 }],
    }).success).toBe(false)

    expect(receiptSchema.safeParse({
      ...validReceipt,
      items: [{ ...validReceipt.items[0], quantityReceived: Number.POSITIVE_INFINITY }],
    }).success).toBe(false)
  })
})

describe("dispatchSchema", () => {
  const validDispatch = {
    warehouseId: "warehouse-1",
    worksiteId: "worksite-1",
    productId: "product-1",
    requestItemId: "",
    quantity: "3.5",
    unitOfMeasure: "unidad",
    receiverName: "Camila Torres",
    notes: "",
  }

  it("accepts a complete dispatch payload", () => {
    const result = dispatchSchema.safeParse(validDispatch)
    expect(result.success).toBe(true)
    expect(result.data?.quantity).toBe(3.5)
  })

  it("rejects missing receiver and invalid quantities", () => {
    expect(dispatchSchema.safeParse({ ...validDispatch, receiverName: "" }).success).toBe(false)
    expect(dispatchSchema.safeParse({ ...validDispatch, quantity: "0" }).success).toBe(false)
    expect(dispatchSchema.safeParse({ ...validDispatch, quantity: Number.NaN }).success).toBe(false)
  })
})

describe("stockAdjustmentSchema", () => {
  it("accepts positive and negative adjustment types", () => {
    expect(stockAdjustmentSchema.safeParse({
      warehouseId: "warehouse-1",
      productId: "product-1",
      quantity: 2,
      type: "ajuste_positivo",
      reason: "Conteo físico",
    }).success).toBe(true)

    expect(stockAdjustmentSchema.safeParse({
      warehouseId: "warehouse-1",
      productId: "product-1",
      quantity: 2,
      type: "ajuste_negativo",
      reason: "Merma documentada",
    }).success).toBe(true)
  })

  it("requires a reason and a positive finite quantity", () => {
    expect(stockAdjustmentSchema.safeParse({
      warehouseId: "warehouse-1",
      productId: "product-1",
      quantity: 0,
      type: "ajuste_positivo",
      reason: "",
    }).success).toBe(false)
  })
})

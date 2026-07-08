import { describe, expect, it } from "vitest"
import { createOrderSchema, dispatchSchema, receiptSchema, requestSchema, workerDeliverySchema } from "@/lib/validation/operations"

const validRequest = {
  worksiteId: "worksite-1",
  requestType: "epp",
  urgency: "normal",
  requiredDate: "2026-07-15",
  notes: "",
  items: [
    {
      productId: "product-1",
      productNameFree: null,
      quantity: 2,
      unitOfMeasure: "unidad",
      urgency: "normal",
      requiredDate: "2026-07-15",
      workerId: null,
      suggestedSupplierId: null,
      supplierHint: "",
      sortOrder: 0,
      notes: "",
      attributes: [],
    },
  ],
}

describe("requestSchema", () => {
  it("accepts a request with one shared required date", () => {
    const result = requestSchema.safeParse(validRequest)
    expect(result.success).toBe(true)
  })

  it("rejects a request without a required date", () => {
    const result = requestSchema.safeParse({ ...validRequest, requiredDate: "" })
    expect(result.success).toBe(false)
  })
})

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

  it("accepts a supplier per order item for supplier-split purchase orders", () => {
    const result = createOrderSchema.safeParse({
      ...validOrder,
      items: [{ ...validOrder.items[0], supplierId: "supplier-2" }],
    })

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
    worksiteId: "worksite-1",
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

  it("accepts a worksite receipt", () => {
    expect(receiptSchema.safeParse(validReceipt).success).toBe(true)
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

  it("accepts a fully-rejected line with quantityReceived 0 (M-3)", () => {
    expect(receiptSchema.safeParse({
      ...validReceipt,
      items: [{ ...validReceipt.items[0], quantityReceived: 0, quantityRejected: 5 }],
    }).success).toBe(true)
  })

  it("rejects a line with all quantities at 0 (M-3)", () => {
    expect(receiptSchema.safeParse({
      ...validReceipt,
      items: [{ ...validReceipt.items[0], quantityReceived: 0, quantityRejected: 0, quantityDamaged: 0 }],
    }).success).toBe(false)
  })
})

describe("dispatchSchema", () => {
  const validDispatch = {
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

describe("workerDeliverySchema", () => {
  const validDelivery = {
    worksiteId: "worksite-1",
    workerId: "worker-1",
    requestItemId: "item-1",
    quantity: "2",
    notes: "",
  }

  it("accepts a worker EPP delivery payload", () => {
    const result = workerDeliverySchema.safeParse(validDelivery)
    expect(result.success).toBe(true)
    expect(result.data?.quantity).toBe(2)
  })

  it("rejects missing worker, item and invalid quantities", () => {
    expect(workerDeliverySchema.safeParse({ ...validDelivery, workerId: "" }).success).toBe(false)
    expect(workerDeliverySchema.safeParse({ ...validDelivery, requestItemId: "" }).success).toBe(false)
    expect(workerDeliverySchema.safeParse({ ...validDelivery, quantity: "0" }).success).toBe(false)
  })

  it("accepts a delivery with old EPP return fields", () => {
    const result = workerDeliverySchema.safeParse({
      ...validDelivery,
      returnProductId: "prod-return-1",
      returnProductNameFree: "",
      returnQuantity: "1",
      returnReason: "desgastado",
      returnNotes: "Casco con golpes y rayaduras",
    })
    expect(result.success).toBe(true)
    expect(result.data?.returnQuantity).toBe(1)
    expect(result.data?.returnReason).toBe("desgastado")
  })

  it("accepts a delivery with free-text return product and no catalog selection", () => {
    const result = workerDeliverySchema.safeParse({
      ...validDelivery,
      returnProductId: "",
      returnProductNameFree: "Casco marca ABC modelo X",
      returnQuantity: "2",
      returnReason: "dañado",
      returnNotes: "",
    })
    expect(result.success).toBe(true)
    expect(result.data?.returnProductNameFree).toBe("Casco marca ABC modelo X")
  })

  it("accepts a delivery without any return fields", () => {
    const result = workerDeliverySchema.safeParse(validDelivery)
    expect(result.success).toBe(true)
    expect(result.data?.returnQuantity).toBeUndefined()
  })
})

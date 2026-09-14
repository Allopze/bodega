import { describe, expect, it } from "vitest"
import {
  selectServiceQuotationSchema,
  serviceItemSchema,
  serviceQuotationUploadSchema,
  serviceRequestSchema,
} from "@/lib/validation/servicios"

const validServiceItem = {
  description: "Mantencion preventiva de equipo",
  location: "Faena Norte",
  quantity: 1,
}

describe("serviceItemSchema", () => {
  it("accepts an item with description and location", () => {
    const result = serviceItemSchema.parse(validServiceItem)

    expect(result.description).toBe("Mantencion preventiva de equipo")
    expect(result.location).toBe("Faena Norte")
    expect(result.quantity).toBe(1)
    expect(result.unitOfMeasure).toBe("servicio")
  })

  it("rejects an empty description", () => {
    const result = serviceItemSchema.safeParse({
      ...validServiceItem,
      description: "   ",
    })

    expect(result.success).toBe(false)
  })
})

describe("serviceRequestSchema", () => {
  it("accepts a request with at least one service", () => {
    const result = serviceRequestSchema.safeParse({
      worksiteId: "ws-1",
      requiredDate: "2026-06-30",
      items: [validServiceItem],
    })

    expect(result.success).toBe(true)
  })

  it("rejects requests without services", () => {
    const result = serviceRequestSchema.safeParse({
      worksiteId: "ws-1",
      requiredDate: "2026-06-30",
      items: [],
    })

    expect(result.success).toBe(false)
  })
})

describe("serviceQuotationUploadSchema", () => {
  it("accepts a complete quotation", () => {
    const result = serviceQuotationUploadSchema.parse({
      requestId: "req-1",
      totalAmount: "125000",
      supplierId: "sup-1",
    })

    expect(result.totalAmount).toBe(125000)
  })

  it("ya no acepta el monto cero", () => {
    // Esta prueba afirmaba lo contrario: que `totalAmount: "0"` era válido. Es
    // exactamente el defecto de COT-003 —una oferta de $0 adjudicable—, así que
    // hubo que invertirla, no ampliarla.
    expect(serviceQuotationUploadSchema.safeParse({
      requestId: "req-1", totalAmount: "0", supplierId: "sup-1",
    }).success).toBe(false)
  })

  it("rejects a negative amount", () => {
    const result = serviceQuotationUploadSchema.safeParse({
      requestId: "req-1",
      totalAmount: -1,
    })

    expect(result.success).toBe(false)
  })
})

describe("selectServiceQuotationSchema", () => {
  it("accepts requestId and quotationId", () => {
    const result = selectServiceQuotationSchema.safeParse({
      requestId: "req-1",
      quotationId: "quote-1",
    })

    expect(result.success).toBe(true)
  })
})

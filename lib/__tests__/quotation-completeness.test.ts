/**
 * `COT-003` (auditoría 2026-09-14): había dos puertas para cargar una oferta y
 * no pedían lo mismo. El borrador descartaba el archivo sin proveedor o con
 * monto no positivo; el Server Action del panel lo aceptaba, porque el
 * `required` del formulario no protege a un Server Action invocado sin
 * navegador. Quedaba una fila «Proveedor sin nombre» por $0 que se podía
 * adjudicar.
 */
import { describe, expect, it } from "vitest"
import { quotationUploadSchema } from "@/lib/validation/repuestos"
import { serviceQuotationUploadSchema } from "@/lib/validation/servicios"
import {
  hasPositiveAmount, hasSupplierIdentity, isCompleteQuotation, quotationCompletenessProblems,
} from "@/lib/validation/quotation-completeness"

const BASE = { requestId: "req-1", totalAmount: 150000, supplierId: "sup-1" }

describe("qué hace que una oferta esté completa", () => {
  it("el proveedor se identifica por el maestro o por nombre libre, pero por alguno", () => {
    expect(hasSupplierIdentity({ totalAmount: 1, supplierId: "sup-1" })).toBe(true)
    expect(hasSupplierIdentity({ totalAmount: 1, supplierNameFree: "Ferretería del sur" })).toBe(true)
    expect(hasSupplierIdentity({ totalAmount: 1 })).toBe(false)
    // Un nombre en blanco no identifica a nadie.
    expect(hasSupplierIdentity({ totalAmount: 1, supplierId: "  ", supplierNameFree: "   " })).toBe(false)
  })

  it("cero no es gratis: es el valor que deja un campo vacío", () => {
    expect(hasPositiveAmount({ totalAmount: 0 })).toBe(false)
    expect(hasPositiveAmount({ totalAmount: -1 })).toBe(false)
    expect(hasPositiveAmount({ totalAmount: Number.NaN })).toBe(false)
    expect(hasPositiveAmount({ totalAmount: 1 })).toBe(true)
  })

  it("dice todo lo que falta de una vez, no lo primero que encuentra", () => {
    expect(quotationCompletenessProblems({ totalAmount: 0 })).toHaveLength(2)
    expect(isCompleteQuotation({ totalAmount: 150000, supplierId: "sup-1" })).toBe(true)
  })
})

describe.each([
  ["repuestos", quotationUploadSchema],
  ["servicios", serviceQuotationUploadSchema],
])("la puerta de %s exige lo mismo que el borrador", (_name, schema) => {
  it("acepta una oferta completa", () => {
    expect(schema.safeParse(BASE).success).toBe(true)
    expect(schema.safeParse({ requestId: "req-1", totalAmount: 999, supplierNameFree: "Taller Pérez" }).success).toBe(true)
  })

  it("rechaza el monto cero, que antes pasaba", () => {
    const result = schema.safeParse({ ...BASE, totalAmount: 0 })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain("mayor que cero")
  })

  it("rechaza la oferta anónima, que antes se etiquetaba «Proveedor sin nombre»", () => {
    const result = schema.safeParse({ requestId: "req-1", totalAmount: 150000, supplierNameFree: "" })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain("Indica el proveedor")
  })

  it("sigue rechazando el monto negativo", () => {
    expect(schema.safeParse({ ...BASE, totalAmount: -5 }).success).toBe(false)
  })
})

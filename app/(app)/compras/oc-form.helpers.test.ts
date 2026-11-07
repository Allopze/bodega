/**
 * COT-001 (auditoría 2026-09-14): seleccionar una oferta aprobaba los ítems y
 * sólo transfería el proveedor. El importe adjudicado y el vínculo con el
 * documento no eran parte del modelo de Nueva OC, y como el precio inicial sale
 * de `product_suppliers`, un ítem libre llegaba en **$0**: una cotización de
 * $150.000 podía originar una OC de $0 sin vínculo ni alerta.
 *
 * La ficha admite dos salidas para una oferta multiítem —asignación por línea o
 * **total de referencia**— y excluye repartir el total implícitamente. Aquí se
 * implementa la segunda: se prefija sólo lo determinable.
 */
import { describe, expect, it } from "vitest"
import { formatCLP } from "@/lib/utils"
import {
  applySuggestedPrices, awardedUnitPrice, ocSubmitLabel, priceHint, priceSourceLabel, suggestedPrice,
} from "./oc-form.helpers"
import type { PendingItemOption } from "./oc-form.types"

function item(overrides: Partial<PendingItemOption> = {}): PendingItemOption {
  return {
    id: "item-1", requestId: "req-1", requestCode: "SOL-1",
    worksiteId: "ws-1", worksiteName: "Faena", productName: "Bomba",
    productSku: null, productId: null, productNameFree: "Bomba a pedido",
    quantity: 1, unitOfMeasure: "unidad", urgency: "normal", notes: null,
    supplierPrices: {}, deliveryMode: "via_oficina", isService: false,
    ...overrides,
  }
}

describe("awardedUnitPrice", () => {
  it("una oferta de una sola línea sí determina su precio", () => {
    expect(awardedUnitPrice(item({
      awardedQuotationId: "q-1", awardedQuotationTotal: 150_000, awardedLineCount: 1,
    }))).toBe(150_000)
  })

  it("y lo divide por la cantidad, porque el precio de la OC es unitario", () => {
    expect(awardedUnitPrice(item({
      awardedQuotationId: "q-1", awardedQuotationTotal: 150_000, awardedLineCount: 1, quantity: 3,
    }))).toBe(50_000)
  })

  it("una oferta multiítem NO se reparte: sería inventar el dato", () => {
    expect(awardedUnitPrice(item({
      awardedQuotationId: "q-1", awardedQuotationTotal: 150_000, awardedLineCount: 3,
    }))).toBeUndefined()
  })

  it("sin adjudicación no hay nada que prefijar", () => {
    expect(awardedUnitPrice(item())).toBeUndefined()
    expect(awardedUnitPrice(item({ awardedQuotationId: "q-1" }))).toBeUndefined()
  })
})

describe("suggestedPrice", () => {
  it("el ítem libre ya no llega en cero cuando hubo oferta", () => {
    // Éste es el caso del hallazgo: sin `productId` no hay precio de catálogo.
    const conOferta = item({
      awardedQuotationId: "q-1", awardedQuotationTotal: 150_000, awardedLineCount: 1,
    })
    expect(suggestedPrice(conOferta, "")).toBe(150_000)
    expect(suggestedPrice(item(), "")).toBeUndefined()
  })

  it("la oferta manda sobre el precio de catálogo", () => {
    // Es el compromiso comercial que se acaba de tomar, no una referencia
    // histórica de otro proveedor.
    const conAmbos = item({
      productId: "prod-1", supplierPrices: { "sup-1": 90_000 },
      awardedQuotationId: "q-1", awardedQuotationTotal: 150_000, awardedLineCount: 1,
    })
    expect(suggestedPrice(conAmbos, "sup-1")).toBe(150_000)
  })

  it("sin oferta sigue mandando el catálogo", () => {
    expect(suggestedPrice(item({ supplierPrices: { "sup-1": 90_000 } }), "sup-1")).toBe(90_000)
  })
})

/**
 * Repuestos vinculados al equipo (2026-11-07): el solicitante declara un precio
 * unitario estimado y la OC lo prefija. El orden del precio sugerido es
 * adjudicada de una línea → estimado del solicitante → catálogo.
 */
describe("precio estimado del solicitante", () => {
  it("prefija el precio estimado cuando no hay adjudicación", () => {
    // Ítem libre de repuesto: sin `productId` no hay catálogo, antes llegaba en $0.
    expect(suggestedPrice(item({ estimatedUnitPrice: 20_000 }), "")).toBe(20_000)
    // Y no depende de que ya se haya elegido proveedor.
    expect(suggestedPrice(item({ estimatedUnitPrice: 20_000 }), "sup-1")).toBe(20_000)
  })

  it("la adjudicación de una línea gana sobre el estimado", () => {
    const conAmbos = item({
      estimatedUnitPrice: 20_000,
      awardedQuotationId: "q-1", awardedQuotationTotal: 150_000, awardedLineCount: 1,
    })
    expect(suggestedPrice(conAmbos, "")).toBe(150_000)
  })

  it("una adjudicación multiítem no se reparte: queda el estimado del solicitante", () => {
    const multi = item({
      estimatedUnitPrice: 20_000,
      awardedQuotationId: "q-1", awardedQuotationTotal: 300_000, awardedLineCount: 2,
    })
    expect(suggestedPrice(multi, "")).toBe(20_000)
  })

  it("el estimado manda sobre el precio de catálogo", () => {
    const conCatalogo = item({ productId: "prod-1", supplierPrices: { "sup-1": 90_000 }, estimatedUnitPrice: 20_000 })
    expect(suggestedPrice(conCatalogo, "sup-1")).toBe(20_000)
  })

  it("un estimado nulo o en cero no dice nada: sigue el catálogo", () => {
    const base = { productId: "prod-1", supplierPrices: { "sup-1": 90_000 } }
    expect(suggestedPrice(item({ ...base, estimatedUnitPrice: null }), "sup-1")).toBe(90_000)
    expect(suggestedPrice(item({ ...base, estimatedUnitPrice: 0 }), "sup-1")).toBe(90_000)
    expect(suggestedPrice(item({ estimatedUnitPrice: 0 }), "")).toBeUndefined()
  })

  it("applySuggestedPrices sigue el mismo orden: adjudicada → estimado → catálogo", () => {
    const items = [
      item({ id: "a", estimatedUnitPrice: 1_000, awardedQuotationId: "q-1", awardedQuotationTotal: 150_000, awardedLineCount: 1 }),
      item({ id: "b", estimatedUnitPrice: 2_000, productId: "p", supplierPrices: { "sup-1": 20_000 } }),
      item({ id: "c", productId: "p", supplierPrices: { "sup-1": 30_000 } }),
      item({ id: "d" }),
    ]
    expect(applySuggestedPrices(items, "sup-1", () => "sup-1")).toEqual({ a: 150_000, b: 2_000, c: 30_000 })
  })

  it("la pista dice que el precio lo estimó el solicitante", () => {
    expect(priceHint(item({ estimatedUnitPrice: 20_000 }), ""))
      .toBe(`Precio estimado por el solicitante: ${formatCLP(20_000)}`)
  })

  it("la pista de la adjudicación gana sobre la del estimado, y la del estimado sobre la de catálogo", () => {
    const adjudicada = item({
      estimatedUnitPrice: 20_000,
      awardedQuotationId: "q-1", awardedQuotationTotal: 150_000, awardedLineCount: 1,
    })
    expect(priceHint(adjudicada, "")).toContain("Oferta adjudicada")
    const conCatalogo = item({ productId: "p", supplierPrices: { "sup-1": 90_000 }, estimatedUnitPrice: 20_000 })
    expect(priceHint(conCatalogo, "sup-1")).toContain("Precio estimado por el solicitante")
  })

  it("la etiqueta bajo el campo nombra el origen del precio, no siempre «catálogo»", () => {
    expect(priceSourceLabel(item({ estimatedUnitPrice: 20_000 }), "")).toBe("estimado")
    expect(priceSourceLabel(item({ supplierPrices: { "sup-1": 20_000 } }), "sup-1")).toBe("catálogo")
    expect(priceSourceLabel(item({
      awardedQuotationId: "q-1", awardedQuotationTotal: 150_000, awardedLineCount: 1,
    }), "")).toBe("adjudicada")
    expect(priceSourceLabel(item(), "sup-1")).toBeNull()
  })
})

describe("applySuggestedPrices", () => {
  it("prefija lo adjudicado y lo de catálogo, y deja en blanco lo indeterminado", () => {
    const items = [
      item({ id: "a", awardedQuotationId: "q-1", awardedQuotationTotal: 150_000, awardedLineCount: 1 }),
      item({ id: "b", productId: "p", supplierPrices: { "sup-1": 20_000 } }),
      item({ id: "c", awardedQuotationId: "q-2", awardedQuotationTotal: 300_000, awardedLineCount: 2 }),
    ]
    const prices = applySuggestedPrices(items, "sup-1", () => "sup-1")
    expect(prices).toEqual({ a: 150_000, b: 20_000 })
    // La línea de la oferta multiítem queda sin precio: la reparte una persona.
    expect(prices.c).toBeUndefined()
  })
})

describe("priceHint", () => {
  it("con adjudicación de una línea muestra el importe adjudicado", () => {
    const hint = priceHint(item({
      awardedQuotationId: "q-1", awardedQuotationTotal: 150_000, awardedLineCount: 1,
    }), "")
    expect(hint).toContain("Oferta adjudicada")
  })

  it("con adjudicación multiítem muestra el total como contraste y pide repartirlo", () => {
    const hint = priceHint(item({
      awardedQuotationId: "q-1", awardedQuotationTotal: 300_000, awardedLineCount: 2,
    }), "")
    expect(hint).toContain("2 líneas")
    expect(hint).toContain("reparte el precio tú")
  })

  it("sin adjudicación sigue diciendo el precio de catálogo", () => {
    expect(priceHint(item({ supplierPrices: { "sup-1": 20_000 } }), "sup-1")).toContain("Precio catálogo")
    expect(priceHint(item(), "sup-1")).toBeNull()
  })
})

describe("ocSubmitLabel", () => {
  it("con una sola OC conserva «Crear OC (N ítems)»", () => {
    expect(ocSubmitLabel(1, 1)).toBe("Crear OC (1 ítem)")
    expect(ocSubmitLabel(5, 1)).toBe("Crear OC (5 ítems)")
    expect(ocSubmitLabel(3, 0)).toBe("Crear OC (3 ítems)")
  })

  it("con varios proveedores dice cuántas OC nacen y cuántos ítems llevan", () => {
    expect(ocSubmitLabel(5, 2)).toBe("Crear 2 OC · 5 ítems")
  })
})

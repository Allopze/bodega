import { describe, expect, it } from "vitest"
import { areEquivalentUnits, matchInvoiceItemsToPurchaseOrderItems } from "./invoice-item-matching"

const items = [
  { id: "oc-1", productName: "Guante Cabritilla Activex", productCode: "05-03-008-T-XL", unitOfMeasure: "PAR" },
  { id: "oc-2", productName: "Guante Cabritilla Activex", productCode: "05-03-008-T-XL", unitOfMeasure: "UN" },
  { id: "oc-3", productName: "Casco Amarillo", productCode: "CAS-01", unitOfMeasure: "UN" },
]

describe("matchInvoiceItemsToPurchaseOrderItems", () => {
  it("links a unique normalized product code", () => {
    const [result] = matchInvoiceItemsToPurchaseOrderItems([
      { productName: "Casco", productCode: "cas 01", unitOfMeasure: "UN", quantity: 1, unitPrice: 1 },
    ], items)
    expect(result).toMatchObject({ ocItemId: "oc-3", matchType: "code", candidateCount: 1 })
  })

  it("does not link a duplicated code without a disambiguating unit", () => {
    const [result] = matchInvoiceItemsToPurchaseOrderItems([
      { productName: "Guante Cabritilla Activex", productCode: "05-03-008-T-XL", unitOfMeasure: null, quantity: 1, unitPrice: 1 },
    ], items)
    expect(result).toMatchObject({ ocItemId: null, matchType: "ambiguous", candidateCount: 2 })
  })

  it("uses a declared document unit only to resolve an otherwise ambiguous match", () => {
    const [result] = matchInvoiceItemsToPurchaseOrderItems([
      { productName: "Guante Cabritilla Activex", productCode: "05-03-008-T-XL", unitOfMeasure: "PAR", quantity: 1, unitPrice: 1 },
    ], items)
    expect(result).toMatchObject({ ocItemId: "oc-1", matchType: "code", candidateCount: 2 })
  })

  it.each(["UN", "UND", "Unidad", "unidades"])("treats %s as the same semantic unit", (documentUnit) => {
    expect(areEquivalentUnits(documentUnit, "unidad")).toBe(true)
  })

  it("uses semantic unit aliases to resolve an otherwise ambiguous code", () => {
    const [result] = matchInvoiceItemsToPurchaseOrderItems([
      { productName: "Guante Cabritilla Activex", productCode: "05-03-008-T-XL", unitOfMeasure: "Unidad", quantity: 1, unitPrice: 1 },
    ], items)

    expect(result).toMatchObject({ ocItemId: "oc-2", matchType: "code", candidateCount: 2 })
  })

  it("does not link a unique code when the declared units are genuinely incompatible", () => {
    const [result] = matchInvoiceItemsToPurchaseOrderItems([
      { productName: "Casco", productCode: "CAS-01", unitOfMeasure: "PAR", quantity: 1, unitPrice: 1 },
    ], items)

    expect(result).toMatchObject({ ocItemId: null, matchType: "unit_mismatch", candidateCount: 1 })
  })

  it("does not silently associate two DTE lines to the same OC line", () => {
    const results = matchInvoiceItemsToPurchaseOrderItems([
      { productName: "Casco", productCode: "CAS-01", unitOfMeasure: "UN", quantity: 1, unitPrice: 1 },
      { productName: "Casco", productCode: "CAS-01", unitOfMeasure: "UN", quantity: 1, unitPrice: 1 },
    ], items)

    expect(results.map((result) => result.ocItemId)).toEqual(["oc-3", null])
  })

  describe("variantes por talla (casos reales de producción)", () => {
    // OC-2026-0043: el catálogo guarda el mismo nombre en todas las tallas;
    // sólo la talla de la variante distingue las líneas de la OC.
    const pantalones = [
      { id: "s", productName: "Pantalón Slack Cargo gabardina gris/naranjo", productCode: "EPP-203", unitOfMeasure: "unidad", sizeLabel: "S" },
      { id: "m", productName: "Pantalón Slack Cargo gabardina gris/naranjo", productCode: "EPP-204", unitOfMeasure: "unidad", sizeLabel: "M" },
      { id: "l", productName: "Pantalón Slack Cargo gabardina gris/naranjo", productCode: "EPP-101", unitOfMeasure: "unidad", sizeLabel: "L" },
      { id: "xl", productName: "Pantalón Slack Cargo gabardina gris/naranjo", productCode: "EPP-205", unitOfMeasure: "unidad", sizeLabel: "XL" },
      { id: "2xl", productName: "Pantalón Slack Cargo gabardina gris/naranjo", productCode: "EPP-206", unitOfMeasure: "unidad", sizeLabel: "2XL" },
    ]
    const line = (productName: string, productCode: string | null = null, unitOfMeasure: string | null = null) =>
      ({ productName, productCode, unitOfMeasure, quantity: 1, unitPrice: 1 })

    it("resuelve por la talla del código del proveedor", () => {
      const results = matchInvoiceItemsToPurchaseOrderItems([
        line("Pantalon Slack Cargo Gabardina Gris/Nara", "12-01-011-T-L"),
        line("Pantalon Slack Cargo Gabardina Gris/Nara", "12-01-011-T-2XL"),
        line("Pantalon Slack Cargo Gabardina Gris/Nara", "12-01-011-T-S"),
      ], pantalones)
      expect(results.map((result) => result.ocItemId)).toEqual(["l", "2xl", "s"])
      expect(results.every((result) => result.matchType === "name")).toBe(true)
    })

    it("resuelve por la talla escrita al final del nombre (T/XXL, T- XL, T T41)", () => {
      const poleras = ["M", "XL", "2XL"].map((size) => ({
        id: size, productName: "Polera Dryfresh Smooth", productCode: null, unitOfMeasure: "unidad", sizeLabel: size,
      }))
      const results = matchInvoiceItemsToPurchaseOrderItems([
        line("POLERA DRYFRESH SMOOTH (H) T/XXL", null, "UN"),
        line("Polera Dryfresh Smooth T- XL"),
      ], poleras)
      expect(results.map((result) => result.ocItemId)).toEqual(["2XL", "XL"])

      const botines = ["41", "42"].map((size) => ({
        id: size, productName: "Botín VFlex V73 Microfiber", productCode: null, unitOfMeasure: "unidad", sizeLabel: size,
      }))
      const [botin] = matchInvoiceItemsToPurchaseOrderItems([line("Botín VFlex V73 Microfiber Negro T T41")], botines)
      expect(botin?.ocItemId).toBe("41")
    })

    it("no enlaza una talla distinta aunque sea el único candidato por nombre", () => {
      const [result] = matchInvoiceItemsToPurchaseOrderItems(
        [line("Pantalon Slack Cargo Gabardina Gris/Nara", "12-01-011-T-3XL")],
        pantalones.slice(0, 1),
      )
      expect(result?.ocItemId).toBeNull()
    })

    it("sigue ambiguo cuando el documento no declara talla", () => {
      const [result] = matchInvoiceItemsToPurchaseOrderItems([line("Pantalon Slack Cargo Gabardina Gris/Nara")], pantalones)
      expect(result).toMatchObject({ ocItemId: null, matchType: "ambiguous" })
    })
  })

  describe("N° de parte de un repuesto de catálogo", () => {
    // El proveedor factura con SU código (el N° de parte), no con nuestro SKU `RPT-NNN`.
    const repuestos = [
      { id: "filtro", productName: "Filtro de aceite", productCode: "RPT-001", partNumber: "1R-0750", unitOfMeasure: "unidad" },
      { id: "pastilla", productName: "Pastilla de freno", productCode: "RPT-002", partNumber: "PF-200", unitOfMeasure: "unidad" },
      { id: "correa", productName: "Correa del alternador", productCode: "RPT-003", partNumber: null, unitOfMeasure: "unidad" },
    ]
    const line = (productName: string, productCode: string | null) =>
      ({ productName, productCode, unitOfMeasure: "UN", quantity: 1, unitPrice: 1 })

    it("enlaza la línea cuyo código del proveedor es el N° de parte, aunque el nombre no se parezca", () => {
      const [result] = matchInvoiceItemsToPurchaseOrderItems([line("ELEMENTO FILTRANTE LUBRICANTE MOTOR", "1R-0750")], repuestos)
      expect(result).toMatchObject({ ocItemId: "filtro", matchType: "code", candidateCount: 1 })
    })

    it("compara el N° de parte normalizado: sin guiones, espacios ni mayúsculas", () => {
      const results = matchInvoiceItemsToPurchaseOrderItems([
        line("Elemento filtrante", "1r 0750"),
        line("Balata delantera", "pf200"),
      ], repuestos)
      expect(results.map((result) => [result.ocItemId, result.matchType])).toEqual([["filtro", "code"], ["pastilla", "code"]])
    })

    it("el SKU sigue enlazando cuando el proveedor factura con nuestro código", () => {
      const [result] = matchInvoiceItemsToPurchaseOrderItems([line("Algo distinto", "RPT-002")], repuestos)
      expect(result).toMatchObject({ ocItemId: "pastilla", matchType: "code" })
    })

    it("sin N° de parte en la OC cae al enlace por nombre, como antes", () => {
      const [result] = matchInvoiceItemsToPurchaseOrderItems([line("Correa del alternador Gates", "K060885")], repuestos)
      expect(result).toMatchObject({ ocItemId: "correa", matchType: "name" })
    })

    it("un código ajeno al SKU y a todos los N° de parte no enlaza por código", () => {
      const [result] = matchInvoiceItemsToPurchaseOrderItems([line("Neumático 295/80", "ZZ-999")], repuestos)
      expect(result).toMatchObject({ ocItemId: null, matchType: "none" })
    })

    it("dos líneas de la OC con el mismo N° de parte quedan ambiguas, no se adivina", () => {
      const [result] = matchInvoiceItemsToPurchaseOrderItems(
        [line("Filtro de aceite", "1R-0750")],
        [
          { ...repuestos[0]!, id: "a" },
          { ...repuestos[0]!, id: "b", productCode: "RPT-009", partNumber: "1R 0750" },
        ],
      )
      expect(result).toMatchObject({ ocItemId: null, matchType: "ambiguous", candidateCount: 2 })
    })

    it("un código que al normalizarse queda vacío no enlaza con líneas sin SKU ni N° de parte", () => {
      const [result] = matchInvoiceItemsToPurchaseOrderItems(
        [line("Sello trasero", "---")],
        [{ id: "libre", productName: "Retén de cigüeñal", productCode: null, partNumber: null, unitOfMeasure: "unidad" }],
      )
      expect(result).toMatchObject({ ocItemId: null, matchType: "none" })
    })
  })
})

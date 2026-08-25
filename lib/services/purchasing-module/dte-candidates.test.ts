import { describe, it, expect } from "vitest"
import { assessDteCandidates } from "./dte-candidates"

const doc = (id: string, rutEmisor: string, fechaEmision: string, montoTotal = 1000) =>
  ({ id, rutEmisor, fechaEmision, montoTotal })

/** Sin ítems ni alias: acá sólo se ejercita el acotado proveedor + fecha. */
const sinEvidencia = { orderItems: [], aliases: [] }

describe("assessDteCandidates · a quién se le ofrece", () => {
  // Regresión del caso real: OC de APRO creada el 2026-08-07 ofrecía las 10
  // facturas de julio del proveedor, todas anteriores a la orden.
  it("descarta los DTE emitidos antes de que la orden existiera", () => {
    const docs = [
      doc("jul-31", "86887200-4", "2026-07-31"),
      doc("jul-01", "86887200-4", "2026-07-01"),
    ]

    const result = assessDteCandidates(docs, { ...sinEvidencia, supplierRut: "86887200-4", createdOn: "2026-08-07" })

    expect(result).toEqual([])
  })

  it("acepta el DTE emitido el mismo día en que se creó la orden", () => {
    const docs = [doc("mismo-dia", "86887200-4", "2026-08-07")]

    const result = assessDteCandidates(docs, { ...sinEvidencia, supplierRut: "86887200-4", createdOn: "2026-08-07" })

    expect(result.map((r) => r.doc.id)).toEqual(["mismo-dia"])
  })

  it("descarta los DTE de otro proveedor aunque la fecha calce", () => {
    const docs = [
      doc("propio", "86887200-4", "2026-08-10"),
      doc("ajeno", "96542490-3", "2026-08-10"),
    ]

    const result = assessDteCandidates(docs, { ...sinEvidencia, supplierRut: "86887200-4", createdOn: "2026-08-01" })

    expect(result.map((r) => r.doc.id)).toEqual(["propio"])
  })

  it("normaliza el RUT antes de comparar: suppliers.rut se ingresa a mano", () => {
    const docs = [doc("con-puntos", "86887200-4", "2026-08-10")]

    const result = assessDteCandidates(docs, { ...sinEvidencia, supplierRut: "86.887.200-4", createdOn: "2026-08-01" })

    expect(result.map((r) => r.doc.id)).toEqual(["con-puntos"])
  })

  it("no ofrece nada cuando el proveedor de la OC no tiene RUT cargado", () => {
    const docs = [doc("cualquiera", "86887200-4", "2026-08-10")]

    expect(assessDteCandidates(docs, { ...sinEvidencia, supplierRut: null, createdOn: "2026-08-01" })).toEqual([])
    expect(assessDteCandidates(docs, { ...sinEvidencia, supplierRut: "", createdOn: "2026-08-01" })).toEqual([])
  })

  it("recorta la lista al tope pedido", () => {
    const docs = Array.from({ length: 30 }, (_, i) =>
      doc(`d${i}`, "86887200-4", "2026-08-10"),
    )

    const result = assessDteCandidates(docs, { ...sinEvidencia, supplierRut: "86887200-4", createdOn: "2026-08-01", limit: 5 })

    expect(result.map((r) => r.doc.id)).toEqual(["d0", "d1", "d2", "d3", "d4"])
  })
})

// La operación factura una OC por DTE, así que el documento correcto trae el
// monto que la orden espera facturar. Se usa para ordenar y marcar, nunca para
// filtrar: un flete o un redondeo no puede sacar el documento de la lista.
describe("assessDteCandidates · monto esperado", () => {
  const docs = [
    doc("lejano", "86887200-4", "2026-08-10", 875245),
    doc("exacto", "86887200-4", "2026-08-09", 28084),
    doc("cercano", "86887200-4", "2026-08-08", 28100),
  ]
  const filtro = { ...sinEvidencia, supplierRut: "86887200-4", createdOn: "2026-08-01", expectedAmount: 28084 }

  it("pone primero el monto que calza exacto", () => {
    const result = assessDteCandidates(docs, filtro)
    expect(result.map((r) => r.doc.id)).toEqual(["exacto", "cercano", "lejano"])
  })

  it("marca sólo el que calza dentro de la tolerancia", () => {
    const result = assessDteCandidates(docs, filtro)
    expect(result.map((r) => r.amountMatches)).toEqual([true, false, false])
  })

  it("no descarta los que no calzan: la factura parcial es legítima", () => {
    expect(assessDteCandidates(docs, filtro)).toHaveLength(3)
  })

  // Sin monto esperado los tres empatan en todo lo anterior y el desempate
  // legítimo es la fecha. Restar los dos `Infinity` daba NaN y se lo saltaba.
  it("sin monto esperado desempata por fecha de emisión, de la más nueva a la más vieja", () => {
    // Entrada deliberadamente desordenada: con el NaN el comparador se leía como
    // "iguales" y la lista salía tal cual entró, pasando la prueba por accidente.
    const desordenados = [docs[2]!, docs[0]!, docs[1]!]

    const result = assessDteCandidates(desordenados, { ...sinEvidencia, supplierRut: "86887200-4", createdOn: "2026-08-01" })

    expect(result.map((r) => r.doc.id)).toEqual(["lejano", "exacto", "cercano"])
    expect(result.every((r) => r.amountMatches === false)).toBe(true)
  })

  it("ignora un monto esperado no positivo", () => {
    const result = assessDteCandidates(docs, { ...filtro, expectedAmount: 0 })
    expect(result.map((r) => r.doc.id)).toEqual(["lejano", "exacto", "cercano"])
  })
})

describe("assessDteCandidates", () => {
  const orderItems = [
    {
      id: "oc-casco",
      productId: "product-casco",
      productName: "Casco amarillo",
      productCode: "CAS-01",
      unitOfMeasure: "unidad",
      quantity: 10,
      invoicedQuantity: 0,
    },
  ]

  it("ranks product evidence before an amount-only coincidence", () => {
    const result = assessDteCandidates([
      {
        ...doc("amount-only", "86887200-4", "2026-08-11", 1000),
        enrichmentStatus: "ready" as const,
        lines: [{
          id: "line-unrelated", lineNumber: 1, productCode: "OTRO", productName: "Producto distinto",
          unitOfMeasure: "unidad", quantity: 10, unitPrice: 100, amount: 1000,
        }],
      },
      {
        ...doc("product-match", "86887200-4", "2026-08-10", 900),
        enrichmentStatus: "ready" as const,
        lines: [{
          id: "line-casco", lineNumber: 1, productCode: "CAS-01", productName: "Casco amarillo",
          unitOfMeasure: "UN", quantity: 9, unitPrice: 100, amount: 900,
        }],
      },
    ], {
      supplierRut: "86887200-4",
      createdOn: "2026-08-01",
      expectedAmount: 1000,
      orderItems,
      aliases: [],
    })

    expect(result.map((candidate) => candidate.doc.id)).toEqual(["product-match", "amount-only"])
    expect(result[0]).toMatchObject({ confidence: "high", amountMatches: false })
    expect(result[0]?.proposedLinks[0]).toMatchObject({ purchaseOrderItemId: "oc-casco", matchType: "sku" })
    expect(result[1]).toMatchObject({ confidence: "low", amountMatches: true })
  })

  it("uses a confirmed supplier alias before the internal SKU", () => {
    const [candidate] = assessDteCandidates([{
      ...doc("alias", "86887200-4", "2026-08-10", 1000),
      enrichmentStatus: "ready" as const,
      lines: [{
        id: "line-alias", lineNumber: 1, productCode: "PROV-778", productName: "Protección craneal",
        unitOfMeasure: "unidad", quantity: 10, unitPrice: 100, amount: 1000,
      }],
    }], {
      supplierRut: "86887200-4",
      createdOn: "2026-08-01",
      expectedAmount: 1000,
      orderItems,
      aliases: [{
        productId: "product-casco",
        normalizedCode: "PROV778",
        normalizedName: "proteccion craneal",
      }],
    })

    expect(candidate?.proposedLinks[0]).toMatchObject({ purchaseOrderItemId: "oc-casco", matchType: "supplier_alias" })
  })

  it("never uses quantity alone to resolve duplicate product lines", () => {
    const [candidate] = assessDteCandidates([{
      ...doc("ambiguous", "86887200-4", "2026-08-10", 500),
      enrichmentStatus: "ready" as const,
      lines: [{
        id: "line-ambiguous", lineNumber: 1, productCode: null, productName: "Casco amarillo",
        unitOfMeasure: "unidad", quantity: 5, unitPrice: 100, amount: 500,
      }],
    }], {
      supplierRut: "86887200-4",
      createdOn: "2026-08-01",
      expectedAmount: 500,
      orderItems: [
        { ...orderItems[0]!, id: "oc-a", quantity: 5 },
        { ...orderItems[0]!, id: "oc-b", quantity: 10 },
      ],
      aliases: [],
    })

    expect(candidate?.proposedLinks[0]).toMatchObject({ purchaseOrderItemId: null, matchType: "ambiguous" })
    expect(candidate?.confidence).toBe("low")
  })

  it("keeps pending evidence visible and applies the limit after ranking", () => {
    const result = assessDteCandidates([
      ...Array.from({ length: 20 }, (_, index) => ({
        ...doc(`pending-${index}`, "86887200-4", "2026-08-10", 1000),
        enrichmentStatus: "pending" as const,
        lines: [],
      })),
      {
        ...doc("late-better", "86887200-4", "2026-08-09", 900),
        enrichmentStatus: "ready" as const,
        lines: [{
          id: "line-better", lineNumber: 1, productCode: "CAS-01", productName: "Casco amarillo",
          unitOfMeasure: "unidad", quantity: 9, unitPrice: 100, amount: 900,
        }],
      },
    ], {
      supplierRut: "86887200-4",
      createdOn: "2026-08-01",
      expectedAmount: 1000,
      orderItems,
      aliases: [],
      limit: 20,
    })

    expect(result).toHaveLength(20)
    expect(result[0]?.doc.id).toBe("late-better")
    expect(result.some((candidate) => candidate.confidence === "unassessed")).toBe(true)
  })
})

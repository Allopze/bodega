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

describe("assessDteCandidates · la OC citada en el XML", () => {
  const base = { ...sinEvidencia, supplierRut: "96542490-3", createdOn: "2026-08-01", orderCode: "OC-2026-0020" }

  it("marca el documento que cita el código de esta orden", () => {
    const docs = [
      { ...doc("cita", "96542490-3", "2026-08-07"), referencedOrderCodes: "20260020" },
      { ...doc("no-cita", "96542490-3", "2026-08-07"), referencedOrderCodes: "20260021" },
    ]

    const result = assessDteCandidates(docs, base)

    expect(result.find((r) => r.doc.id === "cita")!.referencesOrder).toBe(true)
    expect(result.find((r) => r.doc.id === "no-cita")!.referencesOrder).toBe(false)
  })

  it("pone primero al que cita la orden, incluso sin líneas analizadas", () => {
    // Control positivo del orden: sin la cita, "calza" ganaría por monto.
    const docs = [
      { ...doc("calza", "96542490-3", "2026-08-10", 5000), referencedOrderCodes: null },
      { ...doc("cita", "96542490-3", "2026-08-07", 999_999), referencedOrderCodes: "20260020" },
    ]

    const conCita = assessDteCandidates(docs, { ...base, expectedAmount: 5000 })
    expect(conCita.map((r) => r.doc.id)).toEqual(["cita", "calza"])

    const sinCita = assessDteCandidates(
      docs.map((d) => ({ ...d, referencedOrderCodes: null })),
      { ...base, expectedAmount: 5000 },
    )
    expect(sinCita.map((r) => r.doc.id)).toEqual(["calza", "cita"])
  })

  it("cruza una referencia sin el prefijo contra el código con prefijo", () => {
    // Es el caso real: TRECK y APRO escriben "2026-0020", nosotros "OC-2026-0020".
    const docs = [{ ...doc("real", "96542490-3", "2026-08-07"), referencedOrderCodes: "20260020" }]

    expect(assessDteCandidates(docs, base)[0]!.referencesOrder).toBe(true)
  })

  it("lee varias referencias del mismo documento", () => {
    const docs = [{ ...doc("multi", "96542490-3", "2026-08-07"), referencedOrderCodes: "20260019,20260020" }]

    expect(assessDteCandidates(docs, base)[0]!.referencesOrder).toBe(true)
  })

  it("no marca nada cuando la orden no aporta código o el documento no trae referencias", () => {
    const docs = [{ ...doc("d", "96542490-3", "2026-08-07"), referencedOrderCodes: "20260020" }]

    expect(assessDteCandidates(docs, { ...base, orderCode: null })[0]!.referencesOrder).toBe(false)
    expect(assessDteCandidates([doc("sin-ref", "96542490-3", "2026-08-07")], base)[0]!.referencesOrder).toBe(false)
  })

  it("no confunde la numeración interna vieja del proveedor con una OC nuestra", () => {
    // Las 611 facturas previas a la plataforma citan su propio correlativo
    // ("4477", "585."): normalizan a algo que no es ningún código nuestro.
    const docs = [{ ...doc("legado", "96542490-3", "2026-08-07"), referencedOrderCodes: "4477" }]

    expect(assessDteCandidates(docs, base)[0]!.referencesOrder).toBe(false)
  })
})

describe("assessDteCandidates · calidad de la referencia citada", () => {
  const base = { ...sinEvidencia, supplierRut: "96542490-3", createdOn: "2026-08-01", orderCode: "OC-2026-0020" }

  it("distingue la cita exacta de no haber citado nada", () => {
    const docs = [
      { ...doc("exacta", "96542490-3", "2026-08-07"), referencedOrderCodes: "20260020" },
      { ...doc("vacia", "96542490-3", "2026-08-07"), referencedOrderCodes: "" },
    ]

    const result = assessDteCandidates(docs, base)

    expect(result.find((r) => r.doc.id === "exacta")!.orderReference).toBe("exact")
    expect(result.find((r) => r.doc.id === "vacia")!.orderReference).toBe("none")
  })

  it("marca como año suelto la referencia que sólo trae el año de esta OC", () => {
    // Caso reportado en producción: el proveedor escribe "2026" cuando la
    // referencia real era "2026-0020". No identifica ninguna orden del año.
    const docs = [{ ...doc("solo-anio", "96542490-3", "2026-08-07"), referencedOrderCodes: "2026" }]

    const [assessment] = assessDteCandidates(docs, base)

    expect(assessment!.orderReference).toBe("year")
    expect(assessment!.referencesOrder).toBe(false)
  })

  it("reconoce el correlativo citado sin el año, con o sin ceros a la izquierda", () => {
    // 46 de los 667 XML reales citan "26"/"17"/"14". Identifica una orden por
    // año, así que es mucho más fuerte que el año suelto — pero sigue sin ser
    // una cita completa: el mismo "26" puede ser el correlativo del proveedor.
    const docs = [
      { ...doc("corr", "96542490-3", "2026-08-07"), referencedOrderCodes: "20" },
      { ...doc("corr-ceros", "96542490-3", "2026-08-07"), referencedOrderCodes: "0020" },
    ]

    const result = assessDteCandidates(docs, base)

    expect(result.find((r) => r.doc.id === "corr")!.orderReference).toBe("correlative")
    expect(result.find((r) => r.doc.id === "corr-ceros")!.orderReference).toBe("correlative")
    expect(result.every((r) => r.referencesOrder === false)).toBe(true)
  })

  it("no confunde el correlativo de otra orden con el de ésta", () => {
    const docs = [{ ...doc("otro-corr", "96542490-3", "2026-08-07"), referencedOrderCodes: "21" }]

    expect(assessDteCandidates(docs, base)[0]!.orderReference).toBe("foreign")
  })

  it("prefiere la cita más fuerte cuando el documento trae varias", () => {
    const docs = [{ ...doc("mixta", "96542490-3", "2026-08-07"), referencedOrderCodes: "2026,20" }]

    expect(assessDteCandidates(docs, base)[0]!.orderReference).toBe("correlative")
  })

  it("no asciende la referencia parcial por sobre un cruce real", () => {
    // El año suelto no identifica nada: no puede ganarle al que calza el monto.
    const docs = [
      { ...doc("calza", "96542490-3", "2026-08-10", 5000), referencedOrderCodes: null },
      { ...doc("solo-anio", "96542490-3", "2026-08-07", 999_999), referencedOrderCodes: "2026" },
    ]

    const result = assessDteCandidates(docs, { ...base, expectedAmount: 5000 })

    expect(result.map((r) => r.doc.id)).toEqual(["calza", "solo-anio"])
  })

  it("llama ajena a la referencia que cita otra cosa que no es esta OC", () => {
    const docs = [
      { ...doc("otra-oc", "96542490-3", "2026-08-07"), referencedOrderCodes: "20260021" },
      { ...doc("correlativo-proveedor", "96542490-3", "2026-08-07"), referencedOrderCodes: "4477" },
    ]

    const result = assessDteCandidates(docs, base)

    expect(result.find((r) => r.doc.id === "otra-oc")!.orderReference).toBe("foreign")
    expect(result.find((r) => r.doc.id === "correlativo-proveedor")!.orderReference).toBe("foreign")
  })

  it("no confunde el año de otra OC con una referencia incompleta a ésta", () => {
    const docs = [{ ...doc("anio-ajeno", "96542490-3", "2026-08-07"), referencedOrderCodes: "2025" }]

    expect(assessDteCandidates(docs, base)[0]!.orderReference).toBe("foreign")
  })

  it("no clasifica nada cuando la orden no aporta un código legible", () => {
    const docs = [{ ...doc("d", "96542490-3", "2026-08-07"), referencedOrderCodes: "2026" }]

    expect(assessDteCandidates(docs, { ...base, orderCode: null })[0]!.orderReference).toBe("none")
  })

  it("se queda con la mejor referencia cuando el documento cita varias", () => {
    const docs = [{ ...doc("ajena-y-anio", "96542490-3", "2026-08-07"), referencedOrderCodes: "4477,2026" }]

    expect(assessDteCandidates(docs, base)[0]!.orderReference).toBe("year")
  })
})

describe("assessDteCandidates · la tolerancia la fija la configuración", () => {
  const base = { ...sinEvidencia, supplierRut: "96542490-3", createdOn: "2026-08-01", expectedAmount: 10_000 }

  it("con el peso de redondeo, 30 pesos de diferencia no calzan", () => {
    const docs = [doc("casi", "96542490-3", "2026-08-07", 10_030)]

    expect(assessDteCandidates(docs, base)[0]!.amountMatches).toBe(false)
  })

  it("calza cuando administración amplió la tolerancia de conciliación", () => {
    // El badge de la lista y el veredicto del conciliador tienen que responder
    // lo mismo: decir "calza con el saldo" y luego marcar discrepancia sería
    // pedirle al operador que elija a cuál de las dos pantallas creerle.
    const docs = [doc("casi", "96542490-3", "2026-08-07", 10_030)]

    expect(assessDteCandidates(docs, { ...base, clpTolerance: 50 })[0]!.amountMatches).toBe(true)
  })
})

describe("assessDteCandidates · notas de crédito", () => {
  const base = { ...sinEvidencia, supplierRut: "96542490-3", createdOn: "2026-08-01", expectedAmount: 10_000 }

  it("no dice que una nota de crédito calza con el saldo por facturar", () => {
    // El saldo es lo que falta cobrar; una NC resta. Marcarla como "calza"
    // invitaría a adjuntarla creyendo que cierra la orden, y la deja al revés.
    const nc = { ...doc("nc", "96542490-3", "2026-08-07", 10_000), tipoDte: "61" }
    const factura = { ...doc("f", "96542490-3", "2026-08-07", 10_000), tipoDte: "33" }

    const result = assessDteCandidates([nc, factura], base)

    expect(result.find((r) => r.doc.id === "nc")!.amountMatches).toBe(false)
    expect(result.find((r) => r.doc.id === "f")!.amountMatches).toBe(true)
  })
})

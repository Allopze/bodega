import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDteDocumentsFindMany = vi.fn()
const mockInvoicesFindMany = vi.fn()
const mockFuelLoadsFindMany = vi.fn()
const mockUpdateSet = vi.fn()
const mockTransaction = vi.fn()

vi.mock("@/db", () => ({
  db: {
    query: {
      dteDocuments: { findMany: (...args: unknown[]) => mockDteDocumentsFindMany(...args) },
      purchaseOrderInvoices: { findMany: (...args: unknown[]) => mockInvoicesFindMany(...args) },
      fuelLoads: { findMany: (...args: unknown[]) => mockFuelLoadsFindMany(...args) },
    },
    update: () => ({
      set: (...args: unknown[]) => ({
        where: (...whereArgs: unknown[]) => ({
          returning: (...returningArgs: unknown[]) => mockUpdateSet(...args, ...whereArgs, ...returningArgs),
        }),
      }),
    }),
    transaction: (callback: (tx: unknown) => unknown) => mockTransaction(callback),
  },
}))
vi.mock("@/db/schema", () => ({
  dteDocuments: { id: "dte.id", purchaseOrderInvoiceId: "dte.purchase_order_invoice_id", fuelLoadId: "dte.fuel_load_id" },
  purchaseOrderInvoices: { id: "invoice.id" }, fuelLoads: { id: "load.id" },
}))

/** OC viva y anterior al DTE: el caso normal, para que sólo falle lo que el test ataca. */
const ORDER_OK = { status: "sent", deletedAt: null, createdAt: "2026-06-01T00:00:00.000Z" }

const {
  matchToPurchaseOrderInvoices,
  matchToFuelLoads,
  summarizeDteReconciliation,
} = await import("../reconciliation")

describe("summarizeDteReconciliation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("incluye vínculos preexistentes y sus discrepancias en la corrida actual", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([{
      id: "dte-linked", tipoDte: "33", folio: 100, rutEmisor: "11.111.111-1",
      purchaseOrderInvoiceId: "inv-old", fuelLoadId: null, montoTotal: 55_000,
    }])
    mockInvoicesFindMany.mockResolvedValue([{ id: "inv-old", amount: 50_000 }])
    mockFuelLoadsFindMany.mockResolvedValue([])

    await expect(summarizeDteReconciliation("2026-06", "433", [])).resolves.toEqual({
      matched: 1,
      ambiguous: 0,
      unmatched: 0,
      internalAmbiguity: 0,
      discrepancies: 1,
    })
  })

  // La factura TAE mensual trae N líneas y la importación inserta N cargas con
  // el mismo receiptNumber: el vínculo 1:1 no puede representarlo. Contarlo como
  // "sin vínculo" dejaba la corrida en `partial` para siempre.
  it("separa la ambigüedad del lado interno (una factura de combustible sobre varias cargas) de los DTE sin vínculo", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      {
        id: "dte-tae", tipoDte: "33", folio: 500123, rutEmisor: "99520000-7",
        purchaseOrderInvoiceId: null, fuelLoadId: null, montoTotal: 4_000_000,
      },
      {
        id: "dte-solo", tipoDte: "33", folio: 777, rutEmisor: "11111111-1",
        purchaseOrderInvoiceId: null, fuelLoadId: null, montoTotal: 10_000,
      },
    ])
    mockInvoicesFindMany.mockResolvedValue([])
    mockFuelLoadsFindMany.mockResolvedValue([
      { id: "load-1", receiptNumber: "500123", supplier: { rut: "99520000-7" } },
      { id: "load-2", receiptNumber: "500123", supplier: { rut: "99520000-7" } },
    ])

    await expect(summarizeDteReconciliation("2026-06", "433", [])).resolves.toMatchObject({
      unmatched: 1,
      internalAmbiguity: 1,
    })
  })

  // El corte de `countDiscrepancies`: sin ningún vínculo no hay nada que
  // recalcular, y consultar facturas/cargas para nada era la parte caliente de
  // esta función.
  it("no consulta las entidades vinculadas cuando ningún DTE tiene vínculo", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([{
      id: "dte-solo", tipoDte: "33", folio: 900, rutEmisor: "11111111-1",
      purchaseOrderInvoiceId: null, fuelLoadId: null, montoTotal: 1_000,
    }])
    mockFuelLoadsFindMany.mockResolvedValue([])

    await expect(summarizeDteReconciliation("2026-06", "433", [])).resolves.toMatchObject({
      matched: 0,
      unmatched: 1,
      discrepancies: 0,
    })
    expect(mockInvoicesFindMany).not.toHaveBeenCalled()
  })
})

describe("matchToPurchaseOrderInvoices", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateSet.mockResolvedValue([{ id: "dte-1" }])
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
      return callback({
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => {
                return { limit: async () => [{ id: "inv-1" }] }
              },
              limit: async () => [],
            }),
          }),
        }),
        update: () => ({
          set: (...args: unknown[]) => ({
            where: (...whereArgs: unknown[]) => ({
              returning: (...returningArgs: unknown[]) => mockUpdateSet(...args, ...whereArgs, ...returningArgs),
            }),
          }),
        }),
      })
    })
  })

  it("matches a DTE to an OC invoice by folio AND rut", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11.111.111-1", fechaEmision: "2026-06-15", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { ...ORDER_OK, supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ dteDocumentId: "dte-1", matchedEntityId: "inv-1", discrepancy: 0 })
    expect(mockUpdateSet).toHaveBeenCalled()
  })

  it("does not report a purchase match if fuel or another invoice wins the guarded update", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11.111.111-1", fechaEmision: "2026-06-15", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { ...ORDER_OK, supplier: { rut: "11111111-1" } } },
    ])
    // La fila quedó vinculada entre la lectura y el UPDATE condicional.
    mockUpdateSet.mockResolvedValue([])

    await expect(matchToPurchaseOrderInvoices("2026-06", "433")).resolves.toEqual([])
  })

  // `invoiceNumber` lo tipea una persona: antes de normalizar, ninguna de estas
  // formas cruzaba con el folio del DTE y el documento quedaba sin vincular sin
  // explicación. Ver lib/services/dte-portal/folio-match.ts.
  it.each([
    ["ceros a la izquierda", "0000100"],
    ["separador de miles", "1.00"],
    ["prefijo de serie", "F-100"],
    ["rótulo copiado del documento", "N° 100"],
    ["espacios del pegado", " 100 "],
  ])("cruza un número de factura escrito con %s", async (_caso, escrito) => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11.111.111-1", fechaEmision: "2026-06-15", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: escrito, amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { ...ORDER_OK, supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ dteDocumentId: "dte-1", matchedEntityId: "inv-1" })
  })

  // Adivinar cuál de las dos vale vincularía el documento a la compra
  // equivocada, y desde ahí alimentaría la conciliación de montos.
  it("deja sin vincular cuando dos facturas del mismo proveedor normalizan al mismo folio", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11111111-1", fechaEmision: "2026-06-15", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { ...ORDER_OK, supplier: { rut: "11111111-1" } } },
      { id: "inv-2", invoiceNumber: "0100", amount: 50000, purchaseOrderId: "oc-2", purchaseOrder: { ...ORDER_OK, supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toEqual([])
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("no cruza una factura sin número aunque el proveedor calce", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11111111-1", fechaEmision: "2026-06-15", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "sin número", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { ...ORDER_OK, supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toEqual([])
  })

  it("does NOT match when the folio coincides but the rut is different (regression: el folio no es unico global)", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "22222222-2", fechaEmision: "2026-06-15", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { ...ORDER_OK, supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toHaveLength(0)
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("normalizes rut formatting differences (dots, case) before comparing", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11111111-1", fechaEmision: "2026-06-15", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      // El proveedor está guardado con puntos y minúscula en el dígito verificador.
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { ...ORDER_OK, supplier: { rut: "11.111.111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")
    expect(matches).toHaveLength(1)
  })

  it("does not choose between type 33 and 34 with the same folio and supplier", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-33", tipoDte: "33", folio: 100, rutEmisor: "11111111-1", fechaEmision: "2026-06-15", montoTotal: 50000 },
      { id: "dte-34", tipoDte: "34", folio: 100, rutEmisor: "11111111-1", fechaEmision: "2026-06-15", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { ...ORDER_OK, supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toEqual([])
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  // Dentro de tolerancia (redondeo) sí vincula, y deja la diferencia calculada.
  it("reports a discrepancy when amounts differ within tolerance", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11111111-1", fechaEmision: "2026-06-15", montoTotal: 50001 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { ...ORDER_OK, supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")
    expect(matches[0]!.discrepancy).toBe(1)
  })

  // Escribir el vínculo sin que nadie mire ataba evidencia tributaria de otra
  // compra a esta factura; la OC lo sigue ofreciendo como candidato manual.
  it("no vincula automáticamente cuando el monto se sale de la tolerancia", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11111111-1", fechaEmision: "2026-06-15", montoTotal: 3_480_000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 187_000, purchaseOrderId: "oc-1", purchaseOrder: { ...ORDER_OK, supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toEqual([])
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  // Mismo piso que exigen `validateDteForInvoiceTx` y `selectDteCandidates`:
  // un DTE anterior a la OC no puede ser el documento de esa compra.
  it("no vincula un DTE emitido antes de crear la orden", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11111111-1", fechaEmision: "2026-05-20", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { ...ORDER_OK, supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toEqual([])
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  // `deleteOrder` es soft delete y `cancelOrder` no toca las facturas: sin este
  // filtro el DTE de una compra viva se consumía contra una orden muerta.
  it.each([
    ["anulada", { ...ORDER_OK, status: "cancelled" }],
    ["eliminada", { ...ORDER_OK, deletedAt: "2026-06-10T00:00:00.000Z" }],
  ])("no vincula contra la factura de una OC %s", async (_caso, purchaseOrder) => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11111111-1", fechaEmision: "2026-06-15", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { ...purchaseOrder, supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toEqual([])
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  // La colisión 33/34 no tiene por qué caer en el mismo mes: los rangos de
  // folio son independientes. Contando sólo dentro del período, la corrida creía
  // tener un candidato único y ganaba el que llegara primero.
  it("marca ambiguo un folio que otro DTE sin vincular repite en otro período", async () => {
    mockDteDocumentsFindMany
      // documentos del período
      .mockResolvedValueOnce([
        { id: "dte-33", tipoDte: "33", folio: 500, rutEmisor: "76222222-2", fechaEmision: "2026-08-04", montoTotal: 50000 },
      ])
      // hermanos sin vincular de la misma empresa, sin filtro de período
      .mockResolvedValueOnce([
        { id: "dte-33", folio: 500, rutEmisor: "76222222-2" },
        { id: "dte-34", folio: 500, rutEmisor: "76222222-2" },
      ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "500", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { ...ORDER_OK, supplier: { rut: "76222222-2" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-08", "433")

    expect(matches).toEqual([])
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  // Un DTE reclamado no da derecho a crédito fiscal: no se concilia solo.
  it("no vincula un documento reclamado en la plataforma", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      {
        id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11111111-1",
        fechaEmision: "2026-06-15", montoTotal: 50000,
        estadoPlataforma: "Documento reclamado por el receptor",
      },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { ...ORDER_OK, supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toEqual([])
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("returns no matches without querying invoices when there are no unmatched docs", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([])
    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")
    expect(matches).toHaveLength(0)
    expect(mockInvoicesFindMany).not.toHaveBeenCalled()
  })
})

describe("matchToFuelLoads", () => {
  /** Ocupante de la carga que devuelve la consulta de ocupación dentro de la transacción. */
  let fuelLoadOccupant: Array<{ id: string }> = []

  beforeEach(() => {
    vi.clearAllMocks()
    fuelLoadOccupant = []
    mockUpdateSet.mockResolvedValue([{ id: "dte-1" }])
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      select: () => ({
        from: () => ({
          where: () => ({
            // .for("update").limit() → la carga bloqueada; .limit() → la consulta de ocupación
            for: () => ({ limit: async () => [{ id: "load-1" }] }),
            limit: async () => fuelLoadOccupant,
          }),
        }),
      }),
      update: () => ({
        set: (...args: unknown[]) => ({
          where: (...whereArgs: unknown[]) => ({
            returning: (...returningArgs: unknown[]) => mockUpdateSet(...args, ...whereArgs, ...returningArgs),
          }),
        }),
      }),
    }))
  })

  it("matches a DTE to a fuel load by receiptNumber AND supplier rut", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 200, rutEmisor: "99520000-7", fechaEmision: "2026-06-15", montoTotal: 632180 },
    ])
    mockFuelLoadsFindMany.mockResolvedValue([
      { id: "load-1", receiptNumber: "200", totalAmount: 632180, supplier: { rut: "99520000-7" } },
    ])

    const matches = await matchToFuelLoads("2026-06", "433")
    expect(matches).toHaveLength(1)
    expect(matches[0]!.matchType).toBe("fuel_load")
  })

  it("does not match when the receiptNumber coincides but the supplier rut differs", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 200, rutEmisor: "11111111-1", fechaEmision: "2026-06-15", montoTotal: 632180 },
    ])
    mockFuelLoadsFindMany.mockResolvedValue([
      { id: "load-1", receiptNumber: "200", totalAmount: 632180, supplier: { rut: "99520000-7" } },
    ])

    const matches = await matchToFuelLoads("2026-06", "433")
    expect(matches).toHaveLength(0)
  })

  it("does not choose between type 33 and 34 for the same fuel receipt", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-33", tipoDte: "33", folio: 200, rutEmisor: "99520000-7", fechaEmision: "2026-06-15", montoTotal: 632180 },
      { id: "dte-34", tipoDte: "34", folio: 200, rutEmisor: "99520000-7", fechaEmision: "2026-06-15", montoTotal: 632180 },
    ])
    mockFuelLoadsFindMany.mockResolvedValue([
      { id: "load-1", receiptNumber: "200", totalAmount: 632180, supplier: { rut: "99520000-7" } },
    ])

    const matches = await matchToFuelLoads("2026-06", "433")

    expect(matches).toEqual([])
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  // El UPDATE suelto sólo comprobaba que el DOCUMENTO estuviera libre: un 33 y
  // un 34 del mismo emisor en períodos distintos quedaban ambos sobre la carga.
  it("no vincula una carga que ya tiene otro DTE encima", async () => {
    fuelLoadOccupant = [{ id: "dte-viejo" }]
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "34", folio: 200, rutEmisor: "99520000-7", fechaEmision: "2026-07-15", montoTotal: 89000 },
    ])
    mockFuelLoadsFindMany.mockResolvedValue([
      { id: "load-1", receiptNumber: "200", totalAmount: 632180, supplier: { rut: "99520000-7" } },
    ])

    const matches = await matchToFuelLoads("2026-07", "433")

    expect(matches).toEqual([])
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("no vincula un documento reclamado en la plataforma", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      {
        id: "dte-1", tipoDte: "33", folio: 200, rutEmisor: "99520000-7",
        fechaEmision: "2026-06-15", montoTotal: 632180,
        estadoPlataforma: "Documento bloqueado",
      },
    ])
    mockFuelLoadsFindMany.mockResolvedValue([
      { id: "load-1", receiptNumber: "200", totalAmount: 632180, supplier: { rut: "99520000-7" } },
    ])

    const matches = await matchToFuelLoads("2026-06", "433")

    expect(matches).toEqual([])
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })
})

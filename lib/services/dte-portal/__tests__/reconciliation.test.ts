import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDteDocumentsFindMany = vi.fn()
const mockInvoicesFindMany = vi.fn()
const mockFuelLoadsFindMany = vi.fn()
const mockUpdateSet = vi.fn()

vi.mock("@/db", () => ({
  db: {
    query: {
      dteDocuments: { findMany: (...args: unknown[]) => mockDteDocumentsFindMany(...args) },
      purchaseOrderInvoices: { findMany: (...args: unknown[]) => mockInvoicesFindMany(...args) },
      fuelLoads: { findMany: (...args: unknown[]) => mockFuelLoadsFindMany(...args) },
    },
    update: () => ({ set: (...args: unknown[]) => ({ where: (...whereArgs: unknown[]) => mockUpdateSet(...args, ...whereArgs) }) }),
  },
}))
vi.mock("@/db/schema", () => ({
  dteDocuments: {}, purchaseOrderInvoices: {}, fuelLoads: {},
}))

const { matchToPurchaseOrderInvoices, matchToFuelLoads, computeHealthStats } = await import("../reconciliation")

describe("matchToPurchaseOrderInvoices", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateSet.mockResolvedValue(undefined)
  })

  it("matches a DTE to an OC invoice by folio AND rut", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11.111.111-1", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ dteDocumentId: "dte-1", matchedEntityId: "inv-1", discrepancy: 0 })
    expect(mockUpdateSet).toHaveBeenCalled()
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
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11.111.111-1", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: escrito, amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ dteDocumentId: "dte-1", matchedEntityId: "inv-1" })
  })

  // Adivinar cuál de las dos vale vincularía el documento a la compra
  // equivocada, y desde ahí alimentaría la conciliación de montos.
  it("deja sin vincular cuando dos facturas del mismo proveedor normalizan al mismo folio", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11111111-1", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { supplier: { rut: "11111111-1" } } },
      { id: "inv-2", invoiceNumber: "0100", amount: 50000, purchaseOrderId: "oc-2", purchaseOrder: { supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toEqual([])
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("no cruza una factura sin número aunque el proveedor calce", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11111111-1", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "sin número", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toEqual([])
  })

  it("does NOT match when the folio coincides but the rut is different (regression: el folio no es unico global)", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "22222222-2", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")

    expect(matches).toHaveLength(0)
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("normalizes rut formatting differences (dots, case) before comparing", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11111111-1", montoTotal: 50000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      // El proveedor está guardado con puntos y minúscula en el dígito verificador.
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { supplier: { rut: "11.111.111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")
    expect(matches).toHaveLength(1)
  })

  it("reports a discrepancy when amounts differ", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 100, rutEmisor: "11111111-1", montoTotal: 55000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "100", amount: 50000, purchaseOrderId: "oc-1", purchaseOrder: { supplier: { rut: "11111111-1" } } },
    ])

    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")
    expect(matches[0]!.discrepancy).toBe(5000)
    expect(matches[0]!.discrepancyPercent).toBe(10)
  })

  it("returns no matches without querying invoices when there are no unmatched docs", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([])
    const matches = await matchToPurchaseOrderInvoices("2026-06", "433")
    expect(matches).toHaveLength(0)
    expect(mockInvoicesFindMany).not.toHaveBeenCalled()
  })
})

describe("matchToFuelLoads", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateSet.mockResolvedValue(undefined)
  })

  it("matches a DTE to a fuel load by receiptNumber AND supplier rut", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "dte-1", tipoDte: "33", folio: 200, rutEmisor: "99520000-7", montoTotal: 632180 },
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
      { id: "dte-1", tipoDte: "33", folio: 200, rutEmisor: "11111111-1", montoTotal: 632180 },
    ])
    mockFuelLoadsFindMany.mockResolvedValue([
      { id: "load-1", receiptNumber: "200", totalAmount: 632180, supplier: { rut: "99520000-7" } },
    ])

    const matches = await matchToFuelLoads("2026-06", "433")
    expect(matches).toHaveLength(0)
  })
})

describe("computeHealthStats", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("summarizes estadoSii, reconciliation and credit notes", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "d1", tipoDte: "33", estadoSii: "aceptado", purchaseOrderInvoiceId: "inv-1", fuelLoadId: null, montoTotal: 50000 },
      { id: "d2", tipoDte: "61", estadoSii: null, purchaseOrderInvoiceId: null, fuelLoadId: null, montoTotal: -50000 },
      { id: "d3", tipoDte: "33", estadoSii: "pendiente_envio", purchaseOrderInvoiceId: null, fuelLoadId: "load-1", montoTotal: 632180 },
    ])
    mockInvoicesFindMany.mockResolvedValue([{ id: "inv-1", amount: 50000 }])
    mockFuelLoadsFindMany.mockResolvedValue([{ id: "load-1", totalAmount: 632180 }])

    const stats = await computeHealthStats("2026-06", "433")

    expect(stats.totalDocuments).toBe(3)
    expect(stats.estadoSii.aceptado).toBe(1)
    expect(stats.estadoSii.pendienteEnvio).toBe(1)
    expect(stats.estadoSii.sinEstado).toBe(1)
    expect(stats.reconciliation.matchedToOc).toBe(1)
    expect(stats.reconciliation.matchedToFuel).toBe(1)
    expect(stats.reconciliation.unmatched).toBe(1)
    expect(stats.reconciliation.discrepancies).toBe(0) // los montos coinciden exactamente
    expect(stats.creditNotes.total).toBe(1)
    expect(stats.creditNotes.pending).toBe(1) // la NC no está vinculada a nada
  })

  it("counts a real discrepancy when the linked entity's current amount differs", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "d1", tipoDte: "33", estadoSii: "aceptado", purchaseOrderInvoiceId: "inv-1", fuelLoadId: null, montoTotal: 55000 },
    ])
    mockInvoicesFindMany.mockResolvedValue([{ id: "inv-1", amount: 50000 }])
    mockFuelLoadsFindMany.mockResolvedValue([])

    const stats = await computeHealthStats("2026-06", "433")
    expect(stats.reconciliation.discrepancies).toBe(1)
  })

  it("does not query linked entities when nothing is matched yet", async () => {
    mockDteDocumentsFindMany.mockResolvedValue([
      { id: "d1", tipoDte: "33", estadoSii: null, purchaseOrderInvoiceId: null, fuelLoadId: null, montoTotal: 1000 },
    ])

    const stats = await computeHealthStats("2026-06", "433")
    expect(stats.reconciliation.discrepancies).toBe(0)
    expect(mockInvoicesFindMany).not.toHaveBeenCalled()
    expect(mockFuelLoadsFindMany).not.toHaveBeenCalled()
  })
})

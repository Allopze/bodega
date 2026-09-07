import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.fn()
const mockAssertOrderAccess = vi.fn()
const mockDownloadDteDocumentXml = vi.fn()
const mockGetDteDocumentPdf = vi.fn()
const mockPersistInvoicePdf = vi.fn()
const mockRemoveInvoiceAttachment = vi.fn()
const mockCreatePurchaseOrderInvoiceFromDte = vi.fn()
const mockRevalidateOperationalViews = vi.fn()
const mockLoggerError = vi.fn()
const mockDteLinesFindMany = vi.fn()
const mockDteDocumentFindFirst = vi.fn()
const mockOrderContextRows = vi.fn()
const mockEnrichDteDocumentLines = vi.fn()

vi.mock("@/db", () => ({
  db: {
    query: {
      dteDocumentItems: { findMany: (...args: unknown[]) => mockDteLinesFindMany(...args) },
      dteDocuments: { findFirst: (...args: unknown[]) => mockDteDocumentFindFirst(...args) },
    },
    // OC + RUT del proveedor para el prechequeo de elegibilidad.
    select: () => ({ from: () => ({ leftJoin: () => ({ where: () => mockOrderContextRows() }) }) }),
  },
}))
vi.mock("@/lib/services/dte-portal/purchase-document-xml", () => ({
  enrichDteDocumentLines: (...args: unknown[]) => mockEnrichDteDocumentLines(...args),
}))

vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}))
vi.mock("../actions.helpers", () => ({
  assertOrderAccess: (...args: unknown[]) => mockAssertOrderAccess(...args),
}))
vi.mock("./helpers", async () => ({
  dbErrMsg: (await vi.importActual<typeof import("@/lib/action-error")>("@/lib/action-error")).safeActionMessage,
}))
vi.mock("./dte-download-xml", () => ({
  downloadDteDocumentXml: (...args: unknown[]) => mockDownloadDteDocumentXml(...args),
}))
vi.mock("@/lib/services/dte-portal/purchase-document-pdf", () => ({
  getDteDocumentPdf: (...args: unknown[]) => mockGetDteDocumentPdf(...args),
}))
vi.mock("../invoice-attachments", () => ({
  persistInvoicePdf: (...args: unknown[]) => mockPersistInvoicePdf(...args),
  removeInvoiceAttachment: (...args: unknown[]) => mockRemoveInvoiceAttachment(...args),
}))
vi.mock("@/lib/services/purchasing", () => ({
  createPurchaseOrderInvoiceFromDte: (...args: unknown[]) => mockCreatePurchaseOrderInvoiceFromDte(...args),
}))
vi.mock("@/lib/services/operational-cache", () => ({
  revalidateOperationalViews: (...args: unknown[]) => mockRevalidateOperationalViews(...args),
}))
vi.mock("@/lib/logger", () => ({
  logger: { error: (...args: unknown[]) => mockLoggerError(...args) },
}))

const { attachDteAsInvoice } = await import("./dte-use-invoice")

const XML_DETAIL = {
  tipoDte: "33",
  invoiceNumber: "45678",
  issueDate: "2026-07-28",
  supplierRut: "76.987.654-3",
  netAmount: 100000,
  taxAmount: 19000,
  totalAmount: 119000,
  items: [{
    lineNumber: 1,
    productCode: "CAS-01",
    productName: "Casco amarillo",
    description: null,
    quantity: 10,
    unitOfMeasure: "UN",
    unitPrice: 10000,
    discount: 0,
    amount: 100000,
  }],
}

describe("attachDteAsInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue({ user: { id: "user-1", email: "compras@chome.cl" } })
    mockAssertOrderAccess.mockResolvedValue(null)
    mockDownloadDteDocumentXml.mockResolvedValue({ ok: true, detail: XML_DETAIL })
    mockGetDteDocumentPdf.mockResolvedValue({ buffer: Buffer.from("%PDF-1.7"), fileName: "DTE-33-45678.pdf" })
    mockPersistInvoicePdf.mockResolvedValue({
      attachment: {
        fileName: "DTE-33-45678.pdf",
        filePath: "storage/purchase-orders/dte-33-45678.pdf",
        fileSize: 8,
        mimeType: "application/pdf",
      },
      absolutePath: "/tmp/dte-33-45678.pdf",
    })
    mockCreatePurchaseOrderInvoiceFromDte.mockResolvedValue("inv-1")
    mockDteLinesFindMany.mockResolvedValue([{
      id: "dte-line:dte-1:1",
      dteDocumentId: "dte-1",
      lineNumber: 1,
    }])
    mockEnrichDteDocumentLines.mockResolvedValue({ ok: true, lineCount: 1 })
    mockDteDocumentFindFirst.mockResolvedValue({
      tipoDte: "33",
      rutEmisor: "76987654-3",
      fechaEmision: "2026-07-28",
      purchaseOrderInvoiceId: null,
      fuelLoadId: null,
    })
    mockOrderContextRows.mockReturnValue([{
      createdAt: "2026-07-01T12:00:00.000Z",
      // El portal entrega el RUT sin puntos y `suppliers.rut` se ingresa a
      // mano: el predicado normaliza antes de comparar.
      supplierRut: "76.987.654-3",
    }])
  })

  it("registers and attaches the selected DTE without requiring a manual upload", async () => {
    const result = await attachDteAsInvoice({
      purchaseOrderId: "oc-1",
      dteDocumentId: "dte-1",
      receiptIds: ["receipt-1"],
    })

    expect(result).toEqual({ ok: true, message: "Factura 45678 adjuntada correctamente" })
    expect(mockRequirePermission).toHaveBeenCalledWith("purchasing:send_order")
    expect(mockAssertOrderAccess).toHaveBeenCalledWith(expect.anything(), "oc-1")
    expect(mockGetDteDocumentPdf).toHaveBeenCalledWith("dte-1")
    expect(mockPersistInvoicePdf).toHaveBeenCalledWith(Buffer.from("%PDF-1.7"), "DTE-33-45678.pdf")
    expect(mockCreatePurchaseOrderInvoiceFromDte).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseOrderId: "oc-1",
        dteDocumentId: "dte-1",
        invoiceNumber: "45678",
        amount: 119000,
        amountAuthority: "document_header",
        receiptIds: ["receipt-1"],
        items: [expect.objectContaining({
          productName: "Casco amarillo",
          unitOfMeasure: "UN",
          subtotal: 100000,
        })],
      }),
      expect.anything(),
    )
    expect(mockRevalidateOperationalViews).toHaveBeenCalledWith([
      "/compras",
      "/compras/oc-1",
      "/recepcion",
      "/recepcion/receipt-1",
    ])
  })

  it("rechaza una selección de recepciones inválida antes de consultar la OC o el portal", async () => {
    const result = await attachDteAsInvoice({
      purchaseOrderId: "oc-1",
      dteDocumentId: "dte-1",
      receiptIds: Array.from({ length: 101 }, (_, index) => `receipt-${index}`),
    })

    expect(result).toEqual({ ok: false, message: "Las recepciones seleccionadas no son válidas" })
    expect(mockAssertOrderAccess).not.toHaveBeenCalled()
    expect(mockDownloadDteDocumentXml).not.toHaveBeenCalled()
  })

  it("removes the invoice-owned PDF when the atomic database write fails", async () => {
    mockCreatePurchaseOrderInvoiceFromDte.mockRejectedValue(new Error("Ya existe una factura con ese folio para esta OC"))

    const result = await attachDteAsInvoice({ purchaseOrderId: "oc-1", dteDocumentId: "dte-1" })

    // El rechazo del servicio llega tal cual: casi todos se arreglan desde el
    // mismo diálogo, y un mensaje único los volvía a todos un callejón sin salida.
    expect(result).toEqual({ ok: false, message: "Ya existe una factura con ese folio para esta OC" })
    expect(mockRemoveInvoiceAttachment).toHaveBeenCalledWith("/tmp/dte-33-45678.pdf")
  })

  it("no filtra al cliente el error del driver, que publicaría el SQL y la fila", async () => {
    const driverError = Object.assign(new Error("Failed query: insert into ...\nparams: 119000"), {
      query: "insert into purchase_order_invoices ...",
    })
    mockCreatePurchaseOrderInvoiceFromDte.mockRejectedValue(driverError)

    const result = await attachDteAsInvoice({ purchaseOrderId: "oc-1", dteDocumentId: "dte-1" })

    expect(result).toEqual({ ok: false, message: "No se pudo adjuntar este DTE" })
    expect(mockRemoveInvoiceAttachment).toHaveBeenCalledWith("/tmp/dte-33-45678.pdf")
  })

  it("corta un DTE ya usado antes de golpear el portal y escribir su PDF", async () => {
    mockDteDocumentFindFirst.mockResolvedValue({
      tipoDte: "33",
      rutEmisor: "76987654-3",
      fechaEmision: "2026-07-28",
      purchaseOrderInvoiceId: "inv-otra-oc",
      fuelLoadId: null,
    })

    const result = await attachDteAsInvoice({ purchaseOrderId: "oc-1", dteDocumentId: "dte-1" })

    expect(result).toEqual({ ok: false, message: "Este DTE ya fue usado por otra operación" })
    expect(mockDownloadDteDocumentXml).not.toHaveBeenCalled()
    expect(mockGetDteDocumentPdf).not.toHaveBeenCalled()
    expect(mockPersistInvoicePdf).not.toHaveBeenCalled()
  })

  it("rechaza un tipo de DTE que no puede colgarse de una OC sin descargar nada", async () => {
    // 52 es guía de despacho: acompaña la mercadería, no la cobra. La nota de
    // crédito (61) sí se admite desde que puede registrarse restando.
    mockDteDocumentFindFirst.mockResolvedValue({
      tipoDte: "52",
      rutEmisor: "76987654-3",
      fechaEmision: "2026-07-28",
      purchaseOrderInvoiceId: null,
      fuelLoadId: null,
    })

    const result = await attachDteAsInvoice({ purchaseOrderId: "oc-1", dteDocumentId: "dte-1" })

    expect(result).toEqual({ ok: false, message: "Este tipo de DTE no puede registrarse contra una OC" })
    expect(mockDownloadDteDocumentXml).not.toHaveBeenCalled()
  })

  it("corta un DTE de otro proveedor antes de descargar su XML", async () => {
    mockDteDocumentFindFirst.mockResolvedValue({
      tipoDte: "33",
      rutEmisor: "96542490-3",
      fechaEmision: "2026-07-28",
      purchaseOrderInvoiceId: null,
      fuelLoadId: null,
    })

    const result = await attachDteAsInvoice({ purchaseOrderId: "oc-1", dteDocumentId: "dte-1" })

    expect(result).toEqual({ ok: false, message: "El emisor del DTE no corresponde al proveedor de esta OC" })
    expect(mockDownloadDteDocumentXml).not.toHaveBeenCalled()
  })

  // Un proveedor no puede facturar una orden que todavía no existía.
  it("corta un DTE anterior a la orden antes de descargar su XML", async () => {
    mockDteDocumentFindFirst.mockResolvedValue({
      tipoDte: "33",
      rutEmisor: "76987654-3",
      fechaEmision: "2026-06-30",
      purchaseOrderInvoiceId: null,
      fuelLoadId: null,
    })

    const result = await attachDteAsInvoice({ purchaseOrderId: "oc-1", dteDocumentId: "dte-1" })

    expect(result).toEqual({ ok: false, message: "El DTE fue emitido antes de crear esta orden" })
    expect(mockDownloadDteDocumentXml).not.toHaveBeenCalled()
  })

  it("dice por qué el XML no sirve en vez de un motivo genérico", async () => {
    mockDownloadDteDocumentXml.mockResolvedValue({
      ok: false,
      error: "El XML de este documento pertenece a otra empresa del portal DTE",
    })

    const result = await attachDteAsInvoice({ purchaseOrderId: "oc-1", dteDocumentId: "dte-1" })

    expect(result).toEqual({ ok: false, message: "El XML de este documento pertenece a otra empresa del portal DTE" })
    expect(mockPersistInvoicePdf).not.toHaveBeenCalled()
  })

  it("returns a controlled result when XML retrieval fails unexpectedly", async () => {
    mockDownloadDteDocumentXml.mockRejectedValue(new Error("storage unavailable"))

    const result = await attachDteAsInvoice({ purchaseOrderId: "oc-1", dteDocumentId: "dte-1" })

    expect(result).toEqual({ ok: false, message: "No se pudo verificar el XML del DTE" })
    expect(mockGetDteDocumentPdf).not.toHaveBeenCalled()
  })

  it("returns a controlled result when order access verification fails unexpectedly", async () => {
    mockAssertOrderAccess.mockRejectedValue(new Error("database unavailable"))

    const result = await attachDteAsInvoice({ purchaseOrderId: "oc-1", dteDocumentId: "dte-1" })

    expect(result).toEqual({ ok: false, message: "No se pudo acceder a la orden" })
    expect(mockDownloadDteDocumentXml).not.toHaveBeenCalled()
  })
})

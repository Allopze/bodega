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

vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}))
vi.mock("../actions.helpers", () => ({
  assertOrderAccess: (...args: unknown[]) => mockAssertOrderAccess(...args),
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
  })

  it("registers and attaches the selected DTE without requiring a manual upload", async () => {
    const result = await attachDteAsInvoice({ purchaseOrderId: "oc-1", dteDocumentId: "dte-1" })

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
        items: [expect.objectContaining({
          productName: "Casco amarillo",
          unitOfMeasure: "UN",
          subtotal: 100000,
        })],
      }),
      expect.anything(),
    )
    expect(mockRevalidateOperationalViews).toHaveBeenCalledWith(["/compras", "/compras/oc-1"])
  })

  it("removes the invoice-owned PDF when the atomic database write fails", async () => {
    mockCreatePurchaseOrderInvoiceFromDte.mockRejectedValue(new Error("DTE ya vinculado"))

    const result = await attachDteAsInvoice({ purchaseOrderId: "oc-1", dteDocumentId: "dte-1" })

    expect(result).toEqual({ ok: false, message: "No se pudo adjuntar este DTE" })
    expect(mockRemoveInvoiceAttachment).toHaveBeenCalledWith("/tmp/dte-33-45678.pdf")
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

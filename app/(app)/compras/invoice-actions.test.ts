import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  assertOrderAccess: vi.fn(),
  persistInvoiceFile: vi.fn(),
  removeInvoiceAttachment: vi.fn(),
  extractInvoiceData: vi.fn(),
  createPurchaseOrderInvoice: vi.fn(),
  revalidateOperationalViews: vi.fn(),
}))

vi.mock("@/lib/auth/can", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("./actions.helpers", () => ({ assertOrderAccess: mocks.assertOrderAccess }))
vi.mock("./invoice-attachments", () => ({
  persistInvoiceFile: mocks.persistInvoiceFile,
  removeInvoiceAttachment: mocks.removeInvoiceAttachment,
}))
vi.mock("@/lib/services/purchasing-module/invoice-extractor", () => ({ extractInvoiceData: mocks.extractInvoiceData }))
vi.mock("@/lib/services/purchasing", () => ({
  createPurchaseOrderInvoice: mocks.createPurchaseOrderInvoice,
  deletePurchaseOrderInvoice: vi.fn(),
}))
vi.mock("@/lib/services/operational-cache", () => ({ revalidateOperationalViews: mocks.revalidateOperationalViews }))
vi.mock("@/db", () => ({ db: { query: { purchaseOrderInvoices: { findFirst: vi.fn() } } } }))

const { addInvoiceAction } = await import("./invoice-actions")

function form(confirmUnverified = false, amount = "119000", withLine = false) {
  const data = new FormData()
  data.set("purchaseOrderId", "oc-1")
  data.set("invoiceNumber", "F-100")
  data.set("amount", amount)
  data.set("issueDate", "2026-08-24")
  data.set("itemCount", withLine ? "1" : "0")
  if (withLine) {
    data.set("item_ocItemId_0", "oc-item-1")
    data.set("item_productName_0", "Casco")
    data.set("item_productCode_0", "CASCO-1")
    data.set("item_unitOfMeasure_0", "unidad")
    data.set("item_qty_0", "10")
    data.set("item_price_0", "10000")
    data.set("item_resolution_0", "matched")
  }
  data.set("file", "mocked-file")
  if (confirmUnverified) data.set("confirmUnverifiedSupplier", "on")
  return data
}

describe("addInvoiceAction supplier identity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePermission.mockResolvedValue({ user: { id: "user-1", email: "compras@example.com" } })
    mocks.assertOrderAccess.mockResolvedValue(null)
    mocks.persistInvoiceFile.mockResolvedValue({
      ok: true,
      attachment: {
        attachment: {
          fileName: "factura.pdf",
          filePath: "storage/purchase-orders/factura.pdf",
          fileSize: 10,
          mimeType: "application/pdf",
        },
        absolutePath: "/tmp/factura.pdf",
        verifiedBuffer: Buffer.from("%PDF-1.7"),
      },
    })
    mocks.createPurchaseOrderInvoice.mockResolvedValue("invoice-1")
  })

  it("re-extracts the RUT from the persisted bytes and passes verified evidence to the service", async () => {
    mocks.extractInvoiceData.mockResolvedValue({
      data: { supplierRut: "76.000.001-1" },
      method: "pdf_text",
      quality: { coverage: 0.5, engineConfidence: null, totalsConsistent: null },
    })

    const result = await addInvoiceAction({ ok: false, message: "" }, form())

    expect(result.ok).toBe(true)
    expect(mocks.extractInvoiceData).toHaveBeenCalledWith(Buffer.from("%PDF-1.7"), "application/pdf", "factura.pdf")
    expect(mocks.createPurchaseOrderInvoice).toHaveBeenCalledWith(expect.objectContaining({
      supplierIdentity: {
        documentSupplierRut: "76.000.001-1",
        status: "verified",
        source: "pdf_text",
      },
    }))
  })

  it("preserves the extracted gross document total when invoice lines are net", async () => {
    mocks.extractInvoiceData.mockResolvedValue({
      data: { supplierRut: "76.000.001-1", totalAmount: 119000 },
      method: "pdf_text",
      quality: { coverage: 1, engineConfidence: null, totalsConsistent: true },
    })

    const result = await addInvoiceAction({ ok: false, message: "" }, form(false, "100000", true))

    expect(result.ok).toBe(true)
    expect(mocks.createPurchaseOrderInvoice).toHaveBeenCalledWith(expect.objectContaining({
      amount: 119000,
      amountAuthority: "document_header",
    }))
  })

  it("invalidates the receipt detail when a new invoice is linked from that receipt", async () => {
    mocks.extractInvoiceData.mockResolvedValue({
      data: { supplierRut: "76.000.001-1", totalAmount: 119000 },
      method: "pdf_text",
      quality: { coverage: 1, engineConfidence: null, totalsConsistent: true },
    })

    const data = form(false, "119000")
    data.set("receiptId", "receipt-1")
    await addInvoiceAction({ ok: false, message: "" }, data)

    expect(mocks.revalidateOperationalViews).toHaveBeenCalledWith([
      "/compras",
      "/compras/oc-1",
      "/recepcion",
      "/recepcion/receipt-1",
    ])
  })

  it("requires explicit confirmation and removes the file when no supplier RUT can be extracted", async () => {
    mocks.extractInvoiceData.mockResolvedValue({
      data: { supplierRut: null },
      method: "manual",
      quality: { coverage: 0, engineConfidence: null, totalsConsistent: null },
    })

    const result = await addInvoiceAction({ ok: false, message: "" }, form())

    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/confirma explícitamente/i) })
    expect(mocks.removeInvoiceAttachment).toHaveBeenCalledWith("/tmp/factura.pdf")
    expect(mocks.createPurchaseOrderInvoice).not.toHaveBeenCalled()
  })

  it("persists an explicitly confirmed missing RUT as unverified", async () => {
    mocks.extractInvoiceData.mockResolvedValue({
      data: null,
      method: "manual",
      quality: { coverage: 0, engineConfidence: null, totalsConsistent: null },
    })

    const result = await addInvoiceAction({ ok: false, message: "" }, form(true))

    expect(result.ok).toBe(true)
    expect(mocks.createPurchaseOrderInvoice).toHaveBeenCalledWith(expect.objectContaining({
      supplierIdentity: { documentSupplierRut: null, status: "unverified", source: "manual" },
    }))
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.fn()
const mockFindFirst = vi.fn()
const mockDownloadDteDocumentXml = vi.fn()

vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}))
vi.mock("@/db", () => ({
  db: { query: { dteDocuments: { findFirst: (...args: unknown[]) => mockFindFirst(...args) } } },
}))
vi.mock("@/db/schema", () => ({ dteDocuments: {} }))
vi.mock("./dte-download-xml", () => ({
  downloadDteDocumentXml: (...args: unknown[]) => mockDownloadDteDocumentXml(...args),
}))

const { prefillInvoiceFromDte } = await import("./dte-prefill-invoice")

const BASE_DOC = {
  id: "dte-1",
  folio: 45678,
  fechaEmision: "2026-07-28",
  rutEmisor: "76987654-3",
  razonSocialEmisor: "Señalética Ñuble SpA",
  montoTotal: 119000,
  purchaseOrderInvoiceId: null as string | null,
}

const XML_DETAIL = {
  netAmount: 100000,
  taxAmount: 19000,
  totalAmount: 119000,
  items: [
    {
      lineNumber: 1,
      productCode: "CASCO-01",
      productName: "Casco amarillo",
      description: null,
      quantity: 10,
      unitOfMeasure: "UN",
      unitPrice: 5000,
      discount: 0,
      amount: 50000,
    },
  ],
}

describe("prefillInvoiceFromDte", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue({ user: { id: "user-1" } })
    mockDownloadDteDocumentXml.mockResolvedValue({ ok: true, detail: XML_DETAIL })
  })

  it("exige el permiso de gestión, no el de sólo lectura: alimenta un alta", async () => {
    mockFindFirst.mockResolvedValue(BASE_DOC)

    await prefillInvoiceFromDte("dte-1")

    expect(mockRequirePermission).toHaveBeenCalledWith("purchasing:send_order")
  })

  it("arma el folio, la fecha y los ítems desde el DTE sin pedir el archivo al operador", async () => {
    mockFindFirst.mockResolvedValue(BASE_DOC)

    const result = await prefillInvoiceFromDte("dte-1")

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.data.invoiceNumber).toBe("45678")
    expect(result.result.data.issueDate).toBe("2026-07-28")
    expect(result.result.data.totalAmount).toBe(119000)
    expect(result.result.data.supplierRut).toBe("76987654-3")
    expect(result.result.data.items).toHaveLength(1)
    expect(result.result.data.items[0]).toMatchObject({
      productName: "Casco amarillo",
      productCode: "CASCO-01",
      quantity: 10,
      unitPrice: 5000,
    })
    expect(result.result.method).toBe("dte_portal")
    expect(result.result.quality.totalsConsistent).toBe(true)
  })

  // Sin esta guarda, ofrecer un DTE ya vinculado terminaría creando una segunda
  // factura por el mismo documento tributario.
  it("rechaza un DTE que ya cuelga de una factura", async () => {
    mockFindFirst.mockResolvedValue({ ...BASE_DOC, purchaseOrderInvoiceId: "inv-1" })

    const result = await prefillInvoiceFromDte("dte-1")

    expect(result).toEqual({ ok: false, error: expect.stringContaining("ya está vinculado") })
    expect(mockDownloadDteDocumentXml).not.toHaveBeenCalled()
  })

  it("marca el descuadre cuando neto + IVA no da el total del documento", async () => {
    mockFindFirst.mockResolvedValue(BASE_DOC)
    mockDownloadDteDocumentXml.mockResolvedValue({
      ok: true,
      detail: { ...XML_DETAIL, taxAmount: 15000 },
    })

    const result = await prefillInvoiceFromDte("dte-1")

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.quality.totalsConsistent).toBe(false)
  })

  it("propaga el error del portal en vez de devolver datos a medias", async () => {
    mockFindFirst.mockResolvedValue(BASE_DOC)
    mockDownloadDteDocumentXml.mockResolvedValue({ ok: false, error: "No se pudo descargar el XML" })

    const result = await prefillInvoiceFromDte("dte-1")

    expect(result).toEqual({ ok: false, error: "No se pudo descargar el XML" })
  })

  it("devuelve un error explícito cuando el documento no existe", async () => {
    mockFindFirst.mockResolvedValue(undefined)

    const result = await prefillInvoiceFromDte("missing")

    expect(result).toEqual({ ok: false, error: "Documento DTE no encontrado" })
  })
})

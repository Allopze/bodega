// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DteReceivedCard, type DteReceivedRow } from "./dte-received-card"

const mockDownloadDteDocumentXml = vi.fn()

vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("../actions/dte-download-xml", () => ({
  downloadDteDocumentXml: (...args: unknown[]) => mockDownloadDteDocumentXml(...args),
}))

const { toast } = await import("@/lib/toast")

const BASE_DOC: DteReceivedRow = {
  id: "dte-1",
  tipoDte: "33",
  folio: 12715,
  rutEmisor: "78023530-6",
  razonSocialEmisor: "Proveedor Ficticio SpA",
  montoTotal: 119000,
  estadoSii: "aceptado",
}

describe("DteReceivedCard", () => {
  it("shows an explicit empty state when no DTE is linked to this OC", () => {
    render(<DteReceivedCard docs={[]} />)
    expect(screen.getByText(/sin dte vinculado a esta oc/i)).toBeInTheDocument()
  })

  it("renders the linked DTE with its type, folio, supplier and estado SII", () => {
    render(<DteReceivedCard docs={[BASE_DOC]} />)

    expect(screen.getByText(/factura electrónica.*folio 12715/i)).toBeInTheDocument()
    expect(screen.getByText(/proveedor ficticio spa/i)).toBeInTheDocument()
    expect(screen.getByText(/78023530-6/)).toBeInTheDocument()
    expect(screen.getByText(/aceptado sii/i)).toBeInTheDocument()
    expect(screen.getByText("$119.000")).toBeInTheDocument()
  })

  it("downloads and shows the XML detail on demand", async () => {
    mockDownloadDteDocumentXml.mockResolvedValue({
      ok: true,
      detail: {
        netAmount: 100000,
        taxAmount: 19000,
        totalAmount: 119000,
        items: [{ lineNumber: 1, productCode: null, productName: "Casco", description: null, quantity: 10, unitOfMeasure: "UN", unitPrice: 5000, discount: 0, amount: 50000 }],
      },
    })

    render(<DteReceivedCard docs={[BASE_DOC]} />)
    fireEvent.click(screen.getByRole("button", { name: /ver xml/i }))

    await waitFor(() => expect(mockDownloadDteDocumentXml).toHaveBeenCalledWith("dte-1"))
    expect(await screen.findByText(/casco/i)).toBeInTheDocument()
    expect(screen.getByText(/neto: \$100\.000/i)).toBeInTheDocument()
  })

  it("shows an error toast when the download fails", async () => {
    mockDownloadDteDocumentXml.mockResolvedValue({ ok: false, error: "No se pudo descargar el XML del portal DTE" })

    render(<DteReceivedCard docs={[BASE_DOC]} />)
    fireEvent.click(screen.getByRole("button", { name: /ver xml/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No se pudo descargar el XML del portal DTE"))
  })
})

// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("../invoice-actions", () => ({
  addInvoiceAction: vi.fn(),
  deleteInvoiceAction: vi.fn(),
}))

const mockDownloadDteDocumentXml = vi.fn()
vi.mock("../actions/dte-download-xml", () => ({
  downloadDteDocumentXml: (...args: unknown[]) => mockDownloadDteDocumentXml(...args),
}))
vi.mock("../actions/dte-prefill-invoice", () => ({ prefillInvoiceFromDte: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { InvoicesSection } from "./invoices-section"

describe("InvoicesSection", () => {
  it("does not serialise a pending OC cost as the string null when adding an invoice line", () => {
    render(
      <InvoicesSection
        purchaseOrderId="oc-servicio"
        invoices={[]}
        totalAmount={0}
        canManage
        ocItems={[{
          id: "oc-linea-servicio",
          productName: "Calibración pendiente",
          productCode: null,
          unitOfMeasure: "servicio",
          quantity: 1,
          unitPrice: null,
          subtotal: null,
        }]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /agregar ítem/i }))

    const price = screen.getByPlaceholderText("Precio documento") as HTMLInputElement
    expect(price.value).toBe("")
    expect(screen.getByText(/costo de oc pendiente/i)).toBeInTheDocument()
  })

  it("shows the DTE detail on demand before using it, and hides it again", async () => {
    mockDownloadDteDocumentXml.mockResolvedValue({
      ok: true,
      detail: {
        netAmount: 100000,
        taxAmount: 19000,
        totalAmount: 119000,
        items: [{
          lineNumber: 1, productCode: null, productName: "Casco",
          description: null, quantity: 10, unitOfMeasure: "UN",
          unitPrice: 5000, discount: 0, amount: 50000,
        }],
      },
    })

    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[]}
        totalAmount={119000}
        canManage
        ocItems={[]}
        dteCandidates={[{
          id: "dte-1",
          tipoDte: "33",
          folio: 3692684,
          razonSocialEmisor: "Proveedor Ficticio SpA",
          montoTotal: 119000,
          fechaEmision: "2026-07-09",
          amountMatches: true,
        }]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /ver factura/i }))

    await waitFor(() => expect(mockDownloadDteDocumentXml).toHaveBeenCalledWith("dte-1"))
    expect(await screen.findByText(/casco/i)).toBeInTheDocument()
    expect(screen.getByText(/neto: \$100\.000/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /ocultar detalle/i }))
    expect(screen.queryByText(/casco/i)).not.toBeInTheDocument()
  })
})

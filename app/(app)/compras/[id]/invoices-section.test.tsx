// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAddInvoiceAction = vi.fn()
vi.mock("../invoice-actions", () => ({
  addInvoiceAction: (...args: unknown[]) => mockAddInvoiceAction(...args),
  deleteInvoiceAction: vi.fn(),
}))

const mockUseDteAsInvoice = vi.fn()
vi.mock("../actions/dte-use-invoice", () => ({
  attachDteAsInvoice: (...args: unknown[]) => mockUseDteAsInvoice(...args),
}))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { InvoicesSection } from "./invoices-section"
import { reconcileInvoiceEvidence } from "@/lib/services/purchasing-module/invoice-reconciliation"

function emptyReconciliation(totalOC = 0) {
  return reconcileInvoiceEvidence({ totalOC, orderItems: [], invoices: [] })
}

describe("InvoicesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does not serialise a pending OC cost as the string null when adding an invoice line", () => {
    render(
      <InvoicesSection
        purchaseOrderId="oc-servicio"
        invoices={[]}
        reconciliation={emptyReconciliation()}
        canManage
        canUpdateCatalog={false}
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

  it("opens the supplier PDF when the operator chooses Ver factura", () => {
    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[]}
        reconciliation={emptyReconciliation(119000)}
        canManage
        canUpdateCatalog={false}
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

    const link = screen.getByRole("link", { name: /ver factura/i })
    expect(link).toHaveAttribute("href", "/api/purchase-orders/dtes/dte-1/pdf")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("uses the one-step DTE action instead of only pre-filling a manual upload", async () => {
    mockUseDteAsInvoice.mockResolvedValue({ ok: true, message: "Factura 3692684 adjuntada correctamente" })
    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[]}
        reconciliation={emptyReconciliation(119000)}
        canManage
        canUpdateCatalog={false}
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

    fireEvent.click(screen.getByRole("button", { name: /usar este dte/i }))

    await waitFor(() => expect(mockUseDteAsInvoice).toHaveBeenCalledWith({
      purchaseOrderId: "oc-1",
      dteDocumentId: "dte-1",
    }))
  })

  it("does not submit the manual invoice form when using a DTE", async () => {
    mockUseDteAsInvoice.mockResolvedValue({ ok: true, message: "Factura 3692684 adjuntada correctamente" })
    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[]}
        reconciliation={emptyReconciliation(119000)}
        canManage
        canUpdateCatalog={false}
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

    // Satisfy the form's native required-file constraint: a button without an
    // explicit type would otherwise hide its accidental submit behind browser
    // validation and miss the exact regression we are protecting.
    const fileInput = screen.getByLabelText("Archivo")
    fireEvent.change(fileInput, {
      target: { files: [new File(["%PDF-1.7"], "manual.pdf", { type: "application/pdf" })] },
    })

    const useDteButton = screen.getByRole("button", { name: /usar este dte/i })
    const form = useDteButton.closest("form")
    expect(form).not.toBeNull()
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault())
    form!.addEventListener("submit", onSubmit)

    fireEvent.click(useDteButton)

    await waitFor(() => expect(mockUseDteAsInvoice).toHaveBeenCalledOnce())
    expect(useDteButton).toHaveAttribute("type", "button")
    expect(onSubmit).not.toHaveBeenCalled()
    expect(mockAddInvoiceAction).not.toHaveBeenCalled()
  })

  // OC anulada: la sección existe sólo para soltar el DTE que quedó colgado.
  // Eliminar sí; adjuntar no, porque el servicio rechaza el alta en `cancelled`.
  it("offers deletion but not attachment when the order can no longer receive invoices", () => {
    render(
      <InvoicesSection
        purchaseOrderId="oc-anulada"
        invoices={[{
          id: "inv-1",
          invoiceNumber: "456999",
          amount: 119000,
          issueDate: "2026-07-09",
          fileName: "DTE-33-456999.pdf",
          mimeType: "application/pdf",
          uploadedAt: "2026-07-09T12:00:00.000Z",
        }]}
        reconciliation={emptyReconciliation(119000)}
        canManage
        canUpdateCatalog={false}
        canAttach={false}
        ocItems={[]}
      />,
    )

    expect(screen.getByRole("button", { name: /eliminar factura 456999/i })).toBeInTheDocument()
    expect(screen.queryByText(/adjuntar factura/i)).not.toBeInTheDocument()
  })
})

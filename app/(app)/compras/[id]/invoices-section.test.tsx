// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("../invoice-actions", () => ({
  addInvoiceAction: vi.fn(),
  deleteInvoiceAction: vi.fn(),
}))

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
})

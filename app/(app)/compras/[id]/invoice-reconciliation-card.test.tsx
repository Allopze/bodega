// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("../actions/invoice-reconciliation", () => ({ acceptInvoiceReconciliationAction: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { reconcileInvoiceEvidence } from "@/lib/services/purchasing-module/invoice-reconciliation"
import { InvoiceReconciliationCard } from "./invoice-reconciliation-card"

const orderItem = {
  id: "oc-item", productId: "product-1", productName: "Casco", quantity: 2,
  unitOfMeasure: "unidad", unitPrice: 50, subtotal: 100, currentSupplierPrice: 55,
}
const invoice = {
  id: "invoice-1", invoiceNumber: "123", amount: 100, issueDate: "2026-08-20", uploadedAt: "2026-08-20T12:00:00.000Z",
  fileName: "factura.pdf", mimeType: "application/pdf",
  items: [{
    id: "invoice-item", allocations: [{ id: "invoice-item" + "-allocation", purchaseOrderItemId: "oc-item", quantity: 2, subtotal: 120 }], productName: "Casco", productCode: "CAS-1",
    unitOfMeasure: "unidad", quantity: 2, unitPrice: 60, subtotal: 120,
  }],
}

describe("InvoiceReconciliationCard", () => {
  it("shows supplier prices from each destination allocation", () => {
    const items = [{ ...orderItem, id: "a", productName: "Casco blanco", quantity: 6, subtotal: 30000 }, { ...orderItem, id: "b", productId: "product-2", productName: "Casco azul", quantity: 4, subtotal: 40000 }]
    const splitInvoice = { ...invoice, amount: 100000, items: [{ ...invoice.items[0]!, quantity: 10, subtotal: 100000, allocations: [{ id: "aa", purchaseOrderItemId: "a", quantity: 6, subtotal: 30000 }, { id: "ab", purchaseOrderItemId: "b", quantity: 4, subtotal: 70000 }] }] }
    const evidence = reconcileInvoiceEvidence({ totalOC: 100000, orderItems: items, invoices: [splitInvoice] })
    render(<InvoiceReconciliationCard purchaseOrderId="oc-1" reconciliation={evidence} invoices={[splitInvoice]} canAccept canUpdateCatalog />)
    fireEvent.click(screen.getByRole("button", { name: "Aceptar diferencias" }))
    expect(screen.getByRole("checkbox", { name: /Casco azul.*17.500/ })).toHaveAttribute("value", "invoice-item:b")
    expect(screen.getByRole("checkbox", { name: /Casco blanco.*5.000/ })).toHaveAttribute("value", "invoice-item:a")
  })
  it("shows partial coverage and pending receipt as operational states that cannot be accepted", () => {
    const partial = reconcileInvoiceEvidence({
      totalOC: 100,
      orderItems: [{ ...orderItem, supplierReceivedQuantity: 1 }],
      invoices: [{ ...invoice, amount: 50, items: [{ ...invoice.items[0]!, quantity: 1, unitPrice: 50, subtotal: 50, allocations: [{ ...invoice.items[0]!.allocations[0]!, quantity: 1, subtotal: 50 }] }] }],
    })
    const { rerender } = render(
      <InvoiceReconciliationCard purchaseOrderId="oc-1" reconciliation={partial} invoices={[invoice]} canAccept canUpdateCatalog={false} />,
    )
    expect(screen.getByText("Facturación parcial")).toBeInTheDocument()
    expect(screen.getByText("Saldo por facturar").nextElementSibling).toHaveTextContent("$50")
    expect(screen.queryByRole("button", { name: "Aceptar diferencias" })).not.toBeInTheDocument()

    const awaiting = reconcileInvoiceEvidence({
      totalOC: 100,
      orderItems: [{ ...orderItem, supplierReceivedQuantity: 0 }],
      invoices: [{ ...invoice, items: [{ ...invoice.items[0]!, unitPrice: 50, subtotal: 100, allocations: [{ ...invoice.items[0]!.allocations[0]!, quantity: 2, subtotal: 100 }] }] }],
    })
    rerender(<InvoiceReconciliationCard purchaseOrderId="oc-1" reconciliation={awaiting} invoices={[invoice]} canAccept canUpdateCatalog={false} />)
    expect(screen.getByText("Recepción pendiente")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Aceptar diferencias" })).not.toBeInTheDocument()
  })

  it("does not offer generic acceptance for partial coverage with another difference", () => {
    const partialWithPriceDifference = reconcileInvoiceEvidence({
      totalOC: 100,
      orderItems: [{ ...orderItem, quantity: 2, subtotal: 100, supplierReceivedQuantity: 1 }],
      invoices: [{
        ...invoice,
        amount: 50,
        items: [{ ...invoice.items[0]!, quantity: 1, unitPrice: 40, subtotal: 40, allocations: [{ ...invoice.items[0]!.allocations[0]!, quantity: 1, subtotal: 40 }] }],
      }],
    })

    render(<InvoiceReconciliationCard purchaseOrderId="oc-1" reconciliation={partialWithPriceDifference} invoices={[invoice]} canAccept canUpdateCatalog={false} />)
    expect(partialWithPriceDifference.status).toBe("needs_review")
    expect(partialWithPriceDifference.coverage.status).toBe("partial")
    expect(screen.queryByRole("button", { name: "Aceptar diferencias" })).not.toBeInTheDocument()
  })

  it("renders matched, pending and accepted states", () => {
    const matched = reconcileInvoiceEvidence({
      totalOC: 100,
      orderItems: [orderItem],
      invoices: [{ ...invoice, items: [{ ...invoice.items[0]!, unitPrice: 50, subtotal: 100, allocations: [{ ...invoice.items[0]!.allocations[0]!, quantity: 2, subtotal: 100 }] }] }],
    })
    const { rerender } = render(
      <InvoiceReconciliationCard purchaseOrderId="oc-1" reconciliation={matched} invoices={[invoice]} canAccept canUpdateCatalog />,
    )
    expect(screen.getByText("Conciliada")).toBeInTheDocument()

    const pending = reconcileInvoiceEvidence({ totalOC: 100, orderItems: [orderItem], invoices: [invoice] })
    rerender(<InvoiceReconciliationCard purchaseOrderId="oc-1" reconciliation={pending} invoices={[invoice]} canAccept canUpdateCatalog />)
    expect(screen.getByText("Revisión requerida")).toBeInTheDocument()

    const accepted = reconcileInvoiceEvidence({
      totalOC: 100,
      orderItems: [orderItem],
      invoices: [invoice],
      reviews: [{
        id: "review-1", fingerprint: pending.fingerprint,
        reason: "Diferencia respaldada por la factura adjunta.",
        createdAt: "2026-08-20T13:00:00.000Z", reviewedByName: "Ana",
        evidence: { catalogUpdates: [
          { invoiceItemId: "invoice-item", previousPrice: 55, newPrice: 60, changed: true },
        ] },
      }],
    })
    rerender(<InvoiceReconciliationCard purchaseOrderId="oc-1" reconciliation={accepted} invoices={[invoice]} canAccept canUpdateCatalog />)
    expect(screen.getByText(/catálogo actualizado: casco/i)).toBeInTheDocument()
    expect(screen.getByText("Diferencias aceptadas")).toBeInTheDocument()
    expect(screen.getByText(/aceptada por ana/i)).toBeInTheDocument()
  })

  it("opens an accessible acceptance dialog without the excluded alternative", () => {
    const pending = reconcileInvoiceEvidence({ totalOC: 100, orderItems: [orderItem], invoices: [invoice] })
    render(<InvoiceReconciliationCard purchaseOrderId="oc-1" reconciliation={pending} invoices={[invoice]} canAccept canUpdateCatalog={false} />)

    fireEvent.click(screen.getByRole("button", { name: "Aceptar diferencias" }))
    expect(screen.getByRole("dialog", { name: "Aceptar diferencias de conciliación" })).toBeInTheDocument()
    expect(screen.getByLabelText("Motivo")).toBeRequired()
    expect(screen.queryByText(/factura corregida|nota de crédito/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/actualizar catálogo/i)).not.toBeInTheDocument()
  })
})

describe("InvoiceReconciliationCard · la tolerancia que dice es la que se aplicó", () => {
  const evidencia = (clpTolerance?: number) => reconcileInvoiceEvidence({
    totalOC: 100_000,
    orderItems: [{ id: "i1", productName: "Casco", quantity: 1, unitOfMeasure: "unidad", unitPrice: 100_000, subtotal: 100_000 }],
    invoices: [],
    ...(clpTolerance === undefined ? {} : { clpTolerance }),
  })

  it("muestra el peso de redondeo cuando nadie cambió el parámetro", () => {
    render(<InvoiceReconciliationCard purchaseOrderId="oc-1" reconciliation={evidencia()} invoices={[]} canAccept={false} canUpdateCatalog={false} />)

    expect(screen.getByText(/Tolerancia monetaria: \$1\./)).toBeInTheDocument()
  })

  it("muestra la tolerancia configurada, no una escrita a mano", () => {
    // Con la tolerancia configurable desde Administración, un valor fijo en el
    // texto le mentiría al operador sobre la regla con la que se evaluó su OC.
    render(<InvoiceReconciliationCard purchaseOrderId="oc-1" reconciliation={evidencia(250)} invoices={[]} canAccept={false} canUpdateCatalog={false} />)

    expect(screen.getByText(/Tolerancia monetaria: \$250\./)).toBeInTheDocument()
  })
})

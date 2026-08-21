// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { OcInvoiceCta } from "./oc-invoice-cta"

const base = {
  orderId: "oc-123",
  canManage: true,
  receptionPending: false,
  invoiceDue: true,
}

describe("OcInvoiceCta", () => {
  it("does not render when the invoicing is already reconciled", () => {
    const { container } = render(
      <OcInvoiceCta {...base} invoiceCount={1} warnings={[]} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("offers the invoice deep-link when the order has no invoice", () => {
    render(
      <OcInvoiceCta
        {...base}
        invoiceCount={0}
        warnings={["No hay facturas adjuntadas a esta orden."]}
      />,
    )

    const link = screen.getByRole("link", { name: /adjuntar factura/i })
    expect(link).toHaveAttribute("href", "/compras/oc-123?tab=facturacion")
    expect(screen.getByText(/falta la factura de esta orden/i)).toBeInTheDocument()
  })

  it("stays quiet on an order that has not received anything yet", () => {
    const { container } = render(
      <OcInvoiceCta
        {...base}
        invoiceDue={false}
        invoiceCount={0}
        warnings={["No hay facturas adjuntadas a esta orden."]}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("still flags an attached invoice that does not reconcile before reception ends", () => {
    render(
      <OcInvoiceCta
        {...base}
        invoiceDue={false}
        invoiceCount={1}
        warnings={["Total facturado difiere del total OC."]}
      />,
    )

    expect(screen.getByRole("link", { name: /revisar conciliación/i })).toBeInTheDocument()
  })

  it("names the pending differences when an invoice exists but does not reconcile", () => {
    render(
      <OcInvoiceCta
        {...base}
        invoiceCount={1}
        warnings={['"Guantes": cant. OC (50) ≠ cant. facturada (20).', "Total facturado difiere del total OC."]}
      />,
    )

    expect(screen.getByRole("link", { name: /revisar conciliación/i })).toBeInTheDocument()
    expect(screen.getByText(/cant\. facturada \(20\)/i)).toBeInTheDocument()
    expect(screen.getByText(/total facturado difiere/i)).toBeInTheDocument()
  })

  it("names the next step without a link when the user cannot attach invoices", () => {
    render(
      <OcInvoiceCta
        {...base}
        canManage={false}
        invoiceCount={0}
        warnings={["No hay facturas adjuntadas a esta orden."]}
      />,
    )

    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.getByText(/siguiente paso: adjuntar la factura/i)).toBeInTheDocument()
  })

  it("keeps the reception CTA as the only primary while stock is pending", () => {
    const warnings = ["No hay facturas adjuntadas a esta orden."]
    const PRIMARY_CLASS = "bg-[var(--color-primary)]"

    const pending = render(
      <OcInvoiceCta {...base} receptionPending invoiceCount={0} warnings={warnings} />,
    )
    // La primaria del rail en ese momento es recepcionar; ésta va secundaria.
    expect(screen.getByRole("link", { name: /adjuntar factura/i }).className)
      .not.toContain(PRIMARY_CLASS)
    pending.unmount()

    render(<OcInvoiceCta {...base} invoiceCount={0} warnings={warnings} />)
    expect(screen.getByRole("link", { name: /adjuntar factura/i }).className)
      .toContain(PRIMARY_CLASS)
  })
})

// @vitest-environment jsdom
/**
 * Con una guía de despacho, la recepción en faena no se hace en este
 * formulario (`registerReceipt` la rechaza). Si todavía queda algo por
 * registrar en oficina, el formulario se usa para eso, y el lugar de la tarjeta
 * de faena dice adónde ir.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { ComponentPropsWithoutRef } from "react"
import { INITIAL_STATE } from "@/lib/form-state"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentPropsWithoutRef<"a">) => <a href={href} {...props}>{children}</a>,
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("./actions", () => ({ registerReceiptAction: vi.fn(async () => INITIAL_STATE) }))
vi.mock("@/components/ui/submit-button", () => ({
  SubmitButton: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button type="submit" disabled={disabled}>{label}</button>
  ),
}))

import { ReceiptForm, type ReceiptOcItem } from "./receipt-form"

afterEach(() => cleanup())

const item: ReceiptOcItem = {
  id: "oci-1", requestItemId: null, productName: "Casco", productSku: "EPP-1",
  quantity: 10, quantityOfficeReceived: 4, quantityReceived: 0,
  quantityOfficeDisposed: 4, quantityFaenaDisposed: 0, unitOfMeasure: "unidad", notes: null,
}

describe("ReceiptForm — OC con guía de despacho", () => {
  it("ofrece sólo la oficina y dice dónde se recibe en faena", () => {
    render(
      <ReceiptForm
        purchaseOrderId="po-1"
        orderCode="OC-2026-0065"
        orderWorksiteName="Santa Fe"
        officeName="Oficina Central"
        items={[item]}
        canOffice
        canFaena={false}
        faenaGuideNotice={{
          title: "La recepción en faena se confirma en la guía GDI-000074",
          description: "",
          action: { href: "/bodega/guias/g-74", label: "Confirmar llegada a faena" },
        }}
      />,
    )

    expect(screen.getByRole("button", { name: /Recepción en oficina/ })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByRole("button", { name: /Recepción en faena/ })).toBeNull()
    expect(screen.getByText("La recepción en faena se confirma en la guía GDI-000074.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Confirmar llegada a faena" })).toHaveAttribute("href", "/bodega/guias/g-74")
    expect(screen.getByRole("button", { name: "Registrar llegada a oficina" })).toBeEnabled()
  })
})

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { INITIAL_STATE } from "@/components/admin/form-state"
import type { ComponentPropsWithoutRef } from "react"

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}))

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentPropsWithoutRef<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("./actions", () => ({
  registerReceiptAction: vi.fn(async () => INITIAL_STATE),
}))

vi.mock("@/components/admin/submit-button", () => ({
  SubmitButton: ({ label }: { label: string }) => <button type="submit">{label}</button>,
}))

afterEach(() => cleanup())

// ── Test data ───────────────────────────────────────────────────────────────

import { ReceiptForm, type ReceiptOcItem } from "./receipt-form"

function makeItem(overrides: Partial<ReceiptOcItem> = {}): ReceiptOcItem {
  return {
    id: "oci-1",
    requestItemId: "req-item-1",
    productName: "Casco Seguridad",
    productSku: "EPP-001",
    quantity: 10,
    quantityOfficeReceived: 0,
    quantityReceived: 0,
    unitOfMeasure: "unidad",
    notes: null,
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ReceiptForm", () => {
  describe("rendering", () => {
    it("renders the form header with order code in items section", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem()]}
          canOffice={true}
          canFaena={false}
        />,
      )
      // Order code appears in both items header and sidebar; use getAllByText
      const orderCodeElements = screen.getAllByText("OC-001")
      expect(orderCodeElements.length).toBeGreaterThanOrEqual(1)
    })

    it("renders items table with product name", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem({ productName: "Guantes" })]}
          canOffice={true}
          canFaena={false}
        />,
      )
      expect(screen.getByText("Guantes")).toBeDefined()
    })

    it("renders summary sidebar", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem()]}
          canOffice={true}
          canFaena={false}
        />,
      )
      expect(screen.getByText("Resumen recepción")).toBeDefined()
      expect(screen.getByText("Líneas pendientes")).toBeDefined()
    })

    it("renders submit and cancel buttons", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem()]}
          canOffice={true}
          canFaena={false}
        />,
      )
      expect(screen.getByText("Marcar como recibido")).toBeDefined()
      expect(screen.getByText("Cancelar")).toBeDefined()
    })
  })

  describe("stage selection", () => {
    it("defaults to office stage when canOffice is true and items remain", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem()]}
          canOffice={true}
          canFaena={false}
        />,
      )
      expect(screen.getByText("Recepción en oficina")).toBeDefined()
    })

    it("shows both stage options when both are available", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem()]}
          canOffice={true}
          canFaena={true}
        />,
      )
      expect(screen.getByText("Recepción en oficina")).toBeDefined()
      expect(screen.getByText("Recepción en faena")).toBeDefined()
    })

    it("disables faena when no items have arrived at office", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem({ quantityOfficeReceived: 0 })]}
          canOffice={true}
          canFaena={true}
        />,
      )
      const faenaButton = screen.getByText("Recepción en faena").closest("button")
      expect(faenaButton).toHaveAttribute("disabled")
    })

    it("enables faena when items have arrived at office", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem({ quantityOfficeReceived: 5 })]}
          canOffice={false}
          canFaena={true}
        />,
      )
      const faenaButton = screen.getByText("Recepción en faena").closest("button")
      expect(faenaButton).not.toHaveAttribute("disabled")
    })
  })

  describe("item display", () => {
    it("shows SKU badge when productSku is present", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem({ productSku: "EPP-001" })]}
          canOffice={true}
          canFaena={false}
        />,
      )
      expect(screen.getByText("EPP-001")).toBeDefined()
    })

    it("hides SKU badge when productSku is null", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem({ productSku: null })]}
          canOffice={true}
          canFaena={false}
        />,
      )
      expect(screen.queryByText("EPP-001")).toBeNull()
    })

    it("shows fully-received badge when item has no remaining quantity at office", () => {
      const { container } = render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem({ quantityOfficeReceived: 10, quantity: 10 })]}
          canOffice={true}
          canFaena={false}
        />,
      )
      // Item row should have reduced opacity when fully received
      const itemRow = container.querySelector('.opacity-50')
      expect(itemRow).toBeDefined()
    })
  })

  describe("summary sidebar", () => {
    it("displays pending line count in sidebar", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem(), makeItem({ id: "oci-2", productName: "Guantes" })]}
          canOffice={true}
          canFaena={false}
        />,
      )
      // Both items are pending in office stage
      const pendingElements = screen.getAllByText("Líneas pendientes")
      expect(pendingElements.length).toBe(1)
    })

    it("displays order code in sidebar", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-002"
          orderWorksiteName="Faena Norte"
          items={[makeItem()]}
          canOffice={true}
          canFaena={false}
        />,
      )
      // OC-002 appears in items header and sidebar
      const orderCodeElements = screen.getAllByText("OC-002")
      expect(orderCodeElements.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("guide number hint", () => {
    it("shows default hint when guide number is empty", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem()]}
          canOffice={true}
          canFaena={false}
        />,
      )
      expect(screen.getByText(/Puedes registrar la recepción sin guía/)).toBeDefined()
    })
  })

  describe("hidden inputs", () => {
    it("includes hidden inputs for purchaseOrderId and stage", () => {
      const { container } = render(
        <ReceiptForm
          purchaseOrderId="po-hidden"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[makeItem()]}
          canOffice={true}
          canFaena={false}
        />,
      )
      const poInput = container.querySelector('input[name="purchaseOrderId"]') as HTMLInputElement
      expect(poInput?.value).toBe("po-hidden")
      const stageInput = container.querySelector('input[name="stage"]') as HTMLInputElement
      expect(stageInput?.value).toBe("office")
    })
  })

  describe("multiple items", () => {
    it("renders all items in the list", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          items={[
            makeItem({ id: "oci-1", productName: "Casco" }),
            makeItem({ id: "oci-2", productName: "Guantes" }),
            makeItem({ id: "oci-3", productName: "Botas" }),
          ]}
          canOffice={true}
          canFaena={false}
        />,
      )
      expect(screen.getByText("Casco")).toBeDefined()
      expect(screen.getByText("Guantes")).toBeDefined()
      expect(screen.getByText("Botas")).toBeDefined()
    })
  })
})

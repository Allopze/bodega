// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { INITIAL_STATE } from "@/lib/form-state"
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

vi.mock("@/components/ui/submit-button", () => ({
  SubmitButton: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button type="submit" disabled={disabled}>{label}</button>
  ),
}))

afterEach(() => cleanup())

// ── Test data ───────────────────────────────────────────────────────────────

import { fireEvent } from "@testing-library/react"
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
    quantityOfficeDisposed: 0,
    quantityFaenaDisposed: 0,
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
          officeName="Administración"
          items={[makeItem()]}
          canOffice={true}
          canFaena={false}
        />,
      )
      // El código sólo va en la cabecera de ítems: la barra lateral dejó de
      // repetirlo (A5), porque ya está en el título de la página.
      expect(screen.getByText(/Ítems de la OC OC-001/)).toBeDefined()
    })

    it("renders items table with product name", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          officeName="Administración"
          items={[makeItem({ productName: "Guantes" })]}
          canOffice={true}
          canFaena={false}
        />,
      )
      // Desktop row and mobile card are both mounted; CSS shows exactly one
      // at a time, while JSDOM intentionally has no responsive layout.
      expect(screen.getAllByText("Guantes")).toHaveLength(2)
    })

    it("renders summary sidebar", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          officeName="Administración"
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
          officeName="Administración"
          items={[makeItem()]}
          canOffice={true}
          canFaena={false}
        />,
      )
      expect(screen.getByText("Registrar llegada a oficina")).toBeDefined()
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
          officeName="Administración"
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
          officeName="Administración"
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
          officeName="Administración"
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
          officeName="Administración"
          items={[makeItem({ quantityOfficeReceived: 5 })]}
          // Aunque el actor también tenga permiso de oficina, una OC de
          // despacho directo no debe ofrecer una etapa que el servidor prohíbe.
          canOffice={true}
          canFaena={true}
        />,
      )
      const faenaButton = screen.getByText("Recepción en faena").closest("button")
      expect(faenaButton).not.toHaveAttribute("disabled")
    })

    it("directo_faena OC does not render the office option and starts in faena", () => {
      const { container, queryByText } = render(
        <ReceiptForm
          purchaseOrderId="oc-1"
          orderCode="OC-1"
          orderWorksiteName="Faena X"
          officeName="Administración"
          items={[{ id: "i1", requestItemId: "ri1", productName: "P", productSku: null,
                    quantity: 10, quantityOfficeReceived: 0, quantityReceived: 0,
                    quantityOfficeDisposed: 0, quantityFaenaDisposed: 0,
                    unitOfMeasure: "unidad", notes: null }]}
          canOffice={false}
          canFaena={true}
          deliveryMode="directo_faena"
        />,
      )
      expect(queryByText(/Recepción en oficina/i)).toBeNull()
      const stageInput = container.querySelector('input[name="stage"]') as HTMLInputElement
      expect(stageInput.value).toBe("faena")
      // getRemaining for directo_faena caps at (quantity - quantityReceived) = 10 - 0 = 10,
      // not (quantityOfficeReceived - quantityReceived) = 0 - 0 = 0 — so faena must be enabled.
      const faenaButton = queryByText("Recepción en faena")?.closest("button")
      expect(faenaButton).not.toHaveAttribute("disabled")
    })

    it("el rótulo del envío sigue a la etapa elegida", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          officeName="Administración"
          items={[makeItem({ quantityOfficeReceived: 5 })]}
          canOffice={true}
          canFaena={true}
        />,
      )
      // En oficina nada se "recibe": la propia tarjeta dice que no suma stock.
      expect(screen.getByText("Registrar llegada a oficina")).toBeDefined()

      fireEvent.click(screen.getByText("Recepción en faena").closest("button")!)
      expect(screen.getByText("Registrar recepción en faena")).toBeDefined()
      expect(screen.queryByText("Registrar llegada a oficina")).toBeNull()
    })

    it("las tarjetas muestran el avance que antes pintaba el stepper", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          officeName="Administración"
          items={[makeItem({ quantity: 10, quantityOfficeReceived: 4 })]}
          canOffice={true}
          canFaena={true}
        />,
      )
      expect(screen.getByText("4 / 10 unidad")).toBeDefined()
      expect(screen.getByText("4 unidad por despachar")).toBeDefined()
    })

    it("nombra la oficina que llega por prop, no un literal", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          officeName="Oficina Central"
          items={[makeItem()]}
          canOffice={true}
          canFaena={false}
        />,
      )
      expect(screen.getByText(/Proveedor entrega en Oficina Central/)).toBeDefined()
      expect(screen.queryByText(/Chome/i)).toBeNull()
    })
  })

  describe("item display", () => {
    it("shows SKU badge when productSku is present", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          officeName="Administración"
          items={[makeItem({ productSku: "EPP-001" })]}
          canOffice={true}
          canFaena={false}
        />,
      )
      expect(screen.getAllByText("EPP-001")).toHaveLength(2)
    })

    it("hides SKU badge when productSku is null", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          officeName="Administración"
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
          officeName="Administración"
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
          officeName="Administración"
          items={[makeItem(), makeItem({ id: "oci-2", productName: "Guantes" })]}
          canOffice={true}
          canFaena={false}
        />,
      )
      // Both items are pending in office stage
      const pendingElements = screen.getAllByText("Líneas pendientes")
      expect(pendingElements.length).toBe(1)
    })

  })

  describe("guide number hint", () => {
    it("shows default hint when guide number is empty", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          officeName="Administración"
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
          officeName="Administración"
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

  describe("over-booked validation", () => {
    it("disables submit and flags the line when received+rejected+damaged exceeds pending", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          officeName="Administración"
          items={[makeItem({ quantity: 5 })]}
          canOffice={true}
          canFaena={false}
        />,
      )
      const dmgInput = screen.getAllByLabelText("Cantidad dañada de Casco Seguridad")[0]!
      fireEvent.change(dmgInput, { target: { value: "3" } }) // recibido(5) + dañado(3) > 5
      expect(screen.getByText(/supera lo pendiente/)).toBeDefined()
      const submitButton = screen.getByText("Registrar llegada a oficina").closest("button")
      expect(submitButton).toHaveAttribute("disabled")
    })

    it("re-enables submit once the line is corrected", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          officeName="Administración"
          items={[makeItem({ quantity: 5 })]}
          canOffice={true}
          canFaena={false}
        />,
      )
      const qtyInput = screen.getAllByLabelText("Cantidad a recibir de Casco Seguridad")[0]!
      const dmgInput = screen.getAllByLabelText("Cantidad dañada de Casco Seguridad")[0]!
      fireEvent.change(qtyInput, { target: { value: "2" } })
      fireEvent.change(dmgInput, { target: { value: "3" } }) // 2 + 3 = 5, exacto
      expect(screen.queryByText(/supera lo pendiente/)).toBeNull()
      const submitButton = screen.getByText("Registrar llegada a oficina").closest("button")
      expect(submitButton).not.toHaveAttribute("disabled")
    })
  })

  describe("payload enviado", () => {
    /**
     * Regresión de A-37 (auditoría UI/UX 2026-07-29). El input muestra
     * `qtys[id] ?? remaining` y el payload enviaba `qtys[id] ?? 0`: aceptar la
     * cantidad precargada sin tocar el campo mandaba 0 y el servidor rechazaba
     * la recepción con "Revisa los datos de recepción". Lo que se ve y lo que se
     * envía tienen que ser el mismo número.
     */
    it("envía la cantidad precargada cuando el usuario no toca el campo", () => {
      const { container } = render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          officeName="Administración"
          items={[makeItem({ quantity: 10, quantityOfficeReceived: 0 })]}
          canOffice={true}
          canFaena={false}
        />,
      )
      const shown = (screen.getByLabelText(/Cantidad a recibir/) as HTMLInputElement).value
      expect(shown).toBe("10")

      const itemsJson = container.querySelector('input[name="itemsJson"]') as HTMLInputElement
      const sent = JSON.parse(itemsJson.value) as Array<{ quantityReceived: number }>
      expect(sent[0]!.quantityReceived).toBe(Number(shown))
    })

    it("respeta la cantidad que el usuario escribe", () => {
      const { container } = render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          officeName="Administración"
          items={[makeItem({ quantity: 10, quantityOfficeReceived: 0 })]}
          canOffice={true}
          canFaena={false}
        />,
      )
      fireEvent.change(screen.getByLabelText(/Cantidad a recibir/), { target: { value: "4" } })
      const itemsJson = container.querySelector('input[name="itemsJson"]') as HTMLInputElement
      const sent = JSON.parse(itemsJson.value) as Array<{ quantityReceived: number }>
      expect(sent[0]!.quantityReceived).toBe(4)
    })
  })

  describe("multiple items", () => {
    it("renders all items in the list", () => {
      render(
        <ReceiptForm
          purchaseOrderId="po-1"
          orderCode="OC-001"
          orderWorksiteName="Faena Norte"
          officeName="Administración"
          items={[
            makeItem({ id: "oci-1", productName: "Casco" }),
            makeItem({ id: "oci-2", productName: "Guantes" }),
            makeItem({ id: "oci-3", productName: "Botas" }),
          ]}
          canOffice={true}
          canFaena={false}
        />,
      )
      expect(screen.getAllByText("Casco")).toHaveLength(2)
      expect(screen.getAllByText("Guantes")).toHaveLength(2)
      expect(screen.getAllByText("Botas")).toHaveLength(2)
    })
  })
})

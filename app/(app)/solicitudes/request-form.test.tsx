// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { INITIAL_STATE } from "@/lib/form-state"
import type { PropsWithChildren } from "react"
import type { ProductOption } from "./request-form.types"

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("./actions", () => ({
  saveDraft: vi.fn(async () => INITIAL_STATE),
  submitRequest: vi.fn(async () => INITIAL_STATE),
  cancelRequest: vi.fn(async () => INITIAL_STATE),
  deleteRequestAction: vi.fn(async () => INITIAL_STATE),
}))

vi.mock("@/components/ui/submit-button", () => ({
  SubmitButton: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button type="submit" disabled={disabled}>{label}</button>
  ),
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: PropsWithChildren) => <div data-testid="select">{children}</div>,
  SelectTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children, value }: PropsWithChildren<{ value: string }>) => <div data-value={value}>{children}</div>,
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: PropsWithChildren<{ open?: boolean }>) => <div>{open === false ? null : children}</div>,
  DialogTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogDescription: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children, className }: PropsWithChildren<{ className?: string }>) => <div className={className}>{children}</div>,
  DialogClose: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))

vi.mock("./item-editor", () => ({
  ItemEditor: ({
    item,
    idx,
    onSelectProduct,
  }: {
    item: { productName?: string; productNameFree?: string; suggestedSupplierId?: string }
    idx: number
    onSelectProduct: (productId: string) => void
  }) => (
    <div data-testid={`item-editor-${idx}`}>
      <span>{item.productName || "Sin producto"}</span>
      <span data-testid={`item-supplier-${idx}`}>{item.suggestedSupplierId ?? ""}</span>
      <button type="button" onClick={() => onSelectProduct("prod-1")}>Elegir casco</button>
      <button type="button" onClick={() => onSelectProduct("prod-3")}>Elegir insumo</button>
      <button type="button" onClick={() => onSelectProduct("prod-4")}>Elegir insumo sin proveedor</button>
    </div>
  ),
  URGENCY_OPTS: [
    { value: "normal", label: "Normal" },
    { value: "alta", label: "Alta" },
    { value: "critica", label: "Crítica" },
  ],
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ── Test data ───────────────────────────────────────────────────────────────

const worksites = [
  { id: "ws-1", name: "Faena Norte" },
  { id: "ws-2", name: "Faena Sur" },
]

const products: ProductOption[] = [
  {
    id: "prod-1",
    name: "Casco Seguridad",
    sku: "EPP-001",
    unitOfMeasure: "unidad",
    isEpp: true,
    isService: false, requiresWorker: false, equipmentKind: null,
    categoryName: "EPP",
    referencePrice: null,
    familyId: null,
    preferredSupplierId: "sup-1",
    attributes: [],
  },
  {
    id: "prod-2",
    name: "Guantes",
    sku: "EPP-002",
    unitOfMeasure: "par",
    isEpp: true,
    isService: false, requiresWorker: false, equipmentKind: null,
    categoryName: "EPP",
    referencePrice: null,
    familyId: null,
    preferredSupplierId: null,
    attributes: [
      { id: "attr-1", name: "Talla", isRequired: true, drivesQuantity: false, type: "select", options: '["S","M","L"]' },
    ],
  },
  {
    id: "prod-3",
    name: "Insumo Aceite",
    sku: "INS-001",
    unitOfMeasure: "litro",
    isEpp: false,
    isService: false, requiresWorker: false, equipmentKind: null,
    categoryName: "Insumos",
    referencePrice: null,
    familyId: null,
    preferredSupplierId: "sup-1",
    attributes: [],
  },
  {
    id: "prod-4",
    name: "Insumo Trapo",
    sku: "INS-002",
    unitOfMeasure: "kg",
    isEpp: false,
    isService: false, requiresWorker: false, equipmentKind: null,
    categoryName: "Insumos",
    referencePrice: null,
    familyId: null,
    preferredSupplierId: null,
    attributes: [],
  },
]

const suppliers = [
  { id: "sup-1", name: "Proveedor A" },
]

const editableEppRequest = {
  id: "req-epp",
  code: "SOL-EPP",
  status: "draft" as const,
  worksiteId: "ws-1",
  requestType: "epp" as const,
  urgency: "normal",
  requiredDate: "2026-12-01",
  notes: "",
  items: [{
    id: "it-epp", productId: "prod-1", productNameFree: null,
    quantity: 2, unitOfMeasure: "unidad", urgency: "normal",
    suggestedSupplierId: null, supplierHint: null, notes: null,
    status: "draft", workerId: null, workerName: null,
    equipmentCode: null, equipmentLabel: null, attributes: [],
  }],
}

// ── Import after mocks ──────────────────────────────────────────────────────

import { RequestForm } from "./request-form"
import { submitRequest } from "./actions"

// ── Tests ───────────────────────────────────────────────────────────────────

describe("RequestForm", () => {
  beforeEach(() => {
    vi.mocked(submitRequest).mockReset()
    vi.mocked(submitRequest).mockResolvedValue(INITIAL_STATE)
  })

  describe("rendering", () => {
    it("renders the form header", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
        />,
      )
      expect(screen.getByText("Datos de la solicitud")).toBeDefined()
    })

    it("renders items section with initial blank item", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
        />,
      )
      expect(screen.getByText("Ítems solicitados")).toBeDefined()
      // "1 ítem" appears in both items header and sidebar — use getAllByText
      const itemCountElements = screen.getAllByText("1 ítem")
      expect(itemCountElements.length).toBeGreaterThanOrEqual(1)
      expect(screen.getByTestId("item-editor-0")).toBeDefined()
    })

    it("renders worksite selector with options", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
        />,
      )
      // "Faena Norte" appears in SelectItem and in the summary sidebar
      const faenaNorteElements = screen.getAllByText("Faena Norte")
      expect(faenaNorteElements.length).toBeGreaterThanOrEqual(2)
      expect(screen.getAllByText("Faena Sur").length).toBe(1)
    })

    it("renders summary sidebar", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
        />,
      )
      expect(screen.getByText("Resumen")).toBeDefined()
    })

    // EPP/otro se crean y envían en un solo acto: una sola acción primaria y
    // ningún borrador intermedio.
    it("renders a single create-and-submit button for EPP", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
        />,
      )
      expect(screen.getByText("Crear y enviar a aprobación")).toBeDefined()
      expect(screen.queryByText("Guardar borrador")).toBeNull()
    })

    // Repuestos y servicios conservan los dos pasos: hay que adjuntar
    // cotizaciones al borrador antes de enviarlo.
    it("keeps draft + submit buttons for quotation types", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
          userPermissions={["repuestos:create"]}
          initialRequestType="repuestos"
        />,
      )
      expect(screen.getByText("Guardar borrador")).toBeDefined()
      expect(screen.getByText("Enviar a aprobación")).toBeDefined()
    })

    // UX-1: sin esto, el botón nunca se deshabilitaba durante el envío
    // (useFormStatus no funciona sin action= en este form) y un doble click
    // en una conexión lenta despachaba la creación dos veces.
    it("disables the create-and-submit button while the transition is pending", async () => {
      const { submitRequest } = await import("./actions")
      let resolveSubmit!: () => void
      vi.mocked(submitRequest).mockImplementationOnce(() => new Promise((resolve) => {
        resolveSubmit = () => resolve(INITIAL_STATE)
      }))

      // El formulario tiene que estar completo: desde el fix de la cantidad
      // vacía, el envío se corta en cliente si el panel lateral lista algún
      // problema (antes salía igual y el servidor recibía cantidad 1).
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
          editRequest={{
            id: "req-pending",
            code: "SOL-PENDING",
            status: "draft",
            worksiteId: "ws-1",
            requestType: "epp",
            urgency: "normal",
            requiredDate: "2026-12-01",
            notes: "",
            items: [{
              id: "it-1", productId: "prod-1", productNameFree: null,
              quantity: 2, unitOfMeasure: "unidad", urgency: "normal",
              suggestedSupplierId: null, supplierHint: null, notes: null,
              status: "draft", workerId: null, workerName: null,
              equipmentCode: null, equipmentLabel: null, attributes: [],
            }],
          }}
        />,
      )
      const button = screen.getByText("Crear y enviar a aprobación").closest("button")!
      expect(button).not.toBeDisabled()

      fireEvent.submit(button.closest("form")!)
      await vi.waitFor(() => expect(button).toBeDisabled())

      resolveSubmit()
      await vi.waitFor(() => expect(button).not.toBeDisabled())
    })

    it("keeps the specialized route type in the form and summary", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
          userPermissions={["servicios:create"]}
          initialRequestType="servicios"
        />,
      )

      expect(screen.getByText("Flujo para Servicios")).toBeDefined()
      expect(screen.getAllByText("Servicios").length).toBeGreaterThanOrEqual(2)
    })

    it("makes an invalid specialized-route type visible instead of silently using a default", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
          initialRequestType="epp"
          initialRequestTypeNotice="El tipo indicado en el enlace no está disponible para tu cuenta."
        />,
      )

      expect(screen.getByRole("alert")).toHaveTextContent("El tipo indicado en el enlace no está disponible")
    })
  })

  describe("edit mode", () => {
    it("shows read-only notice when request is not in draft state", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
          editRequest={{
            id: "req-1",
            code: "SOL-001",
            status: "approved",
            worksiteId: "ws-1",
            requestType: "epp",
            urgency: "normal",
            requiredDate: "2026-07-01",
            notes: "",
            items: [],
          }}
        />,
      )
      expect(screen.getByText(/solicitud está en estado/)).toBeDefined()
      // "Aprobada" appears in both notice text and sidebar; use getAllByText
      const approvedElements = screen.getAllByText("Aprobada")
      expect(approvedElements.length).toBeGreaterThanOrEqual(1)
    })

    it("shows cancel button for editable requests", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
          editRequest={{
            id: "req-2",
            code: "SOL-002",
            status: "draft",
            worksiteId: "ws-1",
            // El borrador sólo existe para los tipos con cotización.
            requestType: "repuestos",
            urgency: "normal",
            requiredDate: "2026-07-01",
            notes: "",
            items: [],
          }}
        />,
      )
      // "Cancelar solicitud" appears in dialog trigger and potentially elsewhere
      const cancelElements = screen.getAllByText("Cancelar solicitud")
      expect(cancelElements.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("summary sidebar", () => {
    it("shows pending issues when required fields are missing", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
        />,
      )
      // No required date set, so should show "Pendientes"
      expect(screen.getByText("Pendientes")).toBeDefined()
    })

    it("shows correct item count in both header and sidebar", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
        />,
      )
      // "1 ítem" appears in items header count and sidebar badge
      const itemCountElements = screen.getAllByText("1 ítem")
      expect(itemCountElements.length).toBe(2)
    })
  })

  describe("product supplier defaults", () => {
    it("uses the selected EPP preferred supplier as the suggested supplier", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
        />,
      )

      fireEvent.click(screen.getByRole("button", { name: "Elegir casco" }))

      expect(screen.getByTestId("item-supplier-0").textContent).toBe("sup-1")
    })

    it("uses the selected non-EPP preferred supplier as the suggested supplier", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
        />,
      )

      fireEvent.click(screen.getByRole("button", { name: "Elegir insumo" }))

      expect(screen.getByTestId("item-supplier-0").textContent).toBe("sup-1")
    })

    it("leaves suggestedSupplierId empty for non-EPP products without a preferred supplier", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
        />,
      )

      fireEvent.click(screen.getByRole("button", { name: "Elegir insumo sin proveedor" }))

      expect(screen.getByTestId("item-supplier-0").textContent).toBe("")
    })
  })

  describe("EPP stock preflight", () => {
    const stockWarning = {
      ok: true,
      data: {
        kind: "epp-stock-warning",
        confirmationToken: "stock-confirmation-token",
        worksiteName: "Faena Norte",
        items: [
          {
            productId: "prod-1",
            productName: "Casco Seguridad",
            requestedQuantity: 2,
            availableQuantity: 5,
            locationName: "Bodega Faena Norte",
            coverage: "total" as const,
          },
          {
            productId: "prod-2",
            productName: "Guantes",
            requestedQuantity: 4,
            availableQuantity: 1,
            locationName: "Bodega Faena Norte",
            coverage: "partial" as const,
          },
        ],
      },
    }

    function renderEppForm() {
      return render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
          editRequest={editableEppRequest}
        />,
      )
    }

    it("shows every available EPP and never resubmits automatically", async () => {
      const { submitRequest } = await import("./actions")
      vi.mocked(submitRequest).mockResolvedValueOnce(stockWarning)
      renderEppForm()

      fireEvent.submit(screen.getByRole("button", { name: "Crear y enviar a aprobación" }).closest("form")!)

      const dialog = await screen.findByRole("dialog")
      expect(within(dialog).getByText("Hay EPP disponible en bodega")).toBeDefined()
      expect(within(dialog).getByText("Casco Seguridad")).toBeDefined()
      expect(within(dialog).getByText("Guantes")).toBeDefined()
      expect(within(dialog).getAllByText("Solicitado: 2").length).toBeGreaterThan(0)
      expect(within(dialog).getByText("Disponible: 5")).toBeDefined()
      expect(within(dialog).getByText("Cobertura total")).toBeDefined()
      expect(within(dialog).getByText("Cobertura parcial")).toBeDefined()
      expect(within(dialog).getAllByText("Ubicación: Bodega Faena Norte").length).toBeGreaterThanOrEqual(2)
      expect(vi.mocked(submitRequest)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(submitRequest).mock.calls[0]?.[1].get("eppStockConfirmation")).toBeNull()
    })

    it("renders stacked full-width warning actions for narrow screens", async () => {
      vi.mocked(submitRequest).mockResolvedValueOnce(stockWarning)
      renderEppForm()

      fireEvent.submit(screen.getByRole("button", { name: "Crear y enviar a aprobación" }).closest("form")!)

      const dialog = await screen.findByRole("dialog")
      const cancel = within(dialog).getByRole("button", { name: "Cancelar y volver al formulario" })
      const continueRequest = within(dialog).getByRole("button", { name: "Continuar con la solicitud" })
      const footer = continueRequest.parentElement

      expect(footer).toHaveClass("flex-col", "items-stretch", "sm:flex-row")
      expect(cancel).toHaveClass("w-full", "sm:w-auto")
      expect(continueRequest).toHaveClass("w-full", "sm:w-auto")
    })

    it("closes on cancel without creating and only continues with the issued confirmation", async () => {
      const { submitRequest } = await import("./actions")
      vi.mocked(submitRequest)
        .mockResolvedValueOnce(stockWarning)
        .mockResolvedValueOnce({ ...stockWarning, data: { ...stockWarning.data } })
        .mockResolvedValueOnce(INITIAL_STATE)
      renderEppForm()

      fireEvent.submit(screen.getByRole("button", { name: "Crear y enviar a aprobación" }).closest("form")!)
      await screen.findByRole("dialog")
      const firstCall = vi.mocked(submitRequest).mock.calls[0]
      if (!firstCall) throw new Error("Expected first direct submission")
      const firstFormData = firstCall[1]

      fireEvent.click(screen.getByRole("button", { name: "Cancelar y volver al formulario" }))
      expect(screen.queryByRole("dialog")).toBeNull()
      expect(vi.mocked(submitRequest)).toHaveBeenCalledTimes(1)

      // A new preflight can still be started after cancelling the warning.
      fireEvent.submit(screen.getByRole("button", { name: "Crear y enviar a aprobación" }).closest("form")!)
      await screen.findByRole("dialog")
      fireEvent.click(screen.getByRole("button", { name: "Continuar con la solicitud" }))

      await vi.waitFor(() => expect(vi.mocked(submitRequest)).toHaveBeenCalledTimes(3))
      const confirmationCall = vi.mocked(submitRequest).mock.calls[2]
      if (!confirmationCall) throw new Error("Expected confirmed direct submission")
      const confirmationFormData = confirmationCall[1]
      expect(confirmationFormData.get("submissionKey")).toBe(firstFormData.get("submissionKey"))
      expect(confirmationFormData.get("eppStockConfirmation")).toBe("stock-confirmation-token")
    })

    it("invalidates a displayed warning after the requester changes an item", async () => {
      const { submitRequest } = await import("./actions")
      vi.mocked(submitRequest).mockResolvedValueOnce(stockWarning)
      renderEppForm()

      fireEvent.submit(screen.getByRole("button", { name: "Crear y enviar a aprobación" }).closest("form")!)
      await screen.findByRole("dialog")
      fireEvent.click(screen.getByRole("button", { name: "Elegir insumo" }))

      await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
      fireEvent.submit(screen.getByRole("button", { name: "Crear y enviar a aprobación" }).closest("form")!)
      await vi.waitFor(() => expect(vi.mocked(submitRequest)).toHaveBeenCalledTimes(2))
      expect(vi.mocked(submitRequest).mock.calls[1]?.[1].get("eppStockConfirmation")).toBeNull()
    })

    it("keeps a continuation error visible in the warning dialog", async () => {
      const { submitRequest } = await import("./actions")
      vi.mocked(submitRequest)
        .mockResolvedValueOnce(stockWarning)
        .mockResolvedValueOnce({ ok: false, message: "No se pudo consultar el inventario." })
      renderEppForm()

      fireEvent.submit(screen.getByRole("button", { name: "Crear y enviar a aprobación" }).closest("form")!)
      await screen.findByRole("dialog")
      fireEvent.click(screen.getByRole("button", { name: "Continuar con la solicitud" }))

      await vi.waitFor(() => expect(vi.mocked(submitRequest)).toHaveBeenCalledTimes(2))
      expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo consultar el inventario.")
    })
  })
})

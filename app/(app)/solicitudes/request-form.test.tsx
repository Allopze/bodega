// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { INITIAL_STATE } from "@/components/admin/form-state"
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
  resubmitReturnedItemAction: vi.fn(async () => INITIAL_STATE),
}))

vi.mock("@/components/admin/submit-button", () => ({
  SubmitButton: ({ label }: { label: string }) => <button type="submit">{label}</button>,
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: PropsWithChildren) => <div data-testid="select">{children}</div>,
  SelectTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children, value }: PropsWithChildren<{ value: string }>) => <div data-value={value}>{children}</div>,
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogDescription: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
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
    </div>
  ),
  URGENCY_OPTS: [
    { value: "normal", label: "Normal" },
    { value: "alta", label: "Alta" },
    { value: "critica", label: "Crítica" },
  ],
}))

afterEach(() => cleanup())

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
    categoryName: "EPP",
    referencePrice: null,
    preferredSupplierId: "sup-1",
    attributes: [],
  },
  {
    id: "prod-2",
    name: "Guantes",
    sku: "EPP-002",
    unitOfMeasure: "par",
    isEpp: true,
    categoryName: "EPP",
    referencePrice: null,
    preferredSupplierId: null,
    attributes: [
      { id: "attr-1", name: "Talla", isRequired: true, type: "select", options: '["S","M","L"]' },
    ],
  },
]

const suppliers = [
  { id: "sup-1", name: "Proveedor A" },
]

// ── Import after mocks ──────────────────────────────────────────────────────

import { RequestForm } from "./request-form"

// ── Tests ───────────────────────────────────────────────────────────────────

describe("RequestForm", () => {
  describe("rendering", () => {
    it("renders the form header", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          maxFileSizeMb={10}
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
          maxFileSizeMb={10}
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
          maxFileSizeMb={10}
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
          maxFileSizeMb={10}
        />,
      )
      expect(screen.getByText("Resumen")).toBeDefined()
    })

    it("renders save and submit buttons in draft mode", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          maxFileSizeMb={10}
        />,
      )
      expect(screen.getByText("Guardar borrador")).toBeDefined()
      expect(screen.getByText("Enviar a aprobación")).toBeDefined()
    })
  })

  describe("edit mode", () => {
    it("shows read-only notice when request is not in draft state", () => {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={suppliers}
          maxFileSizeMb={10}
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
          maxFileSizeMb={10}
          editRequest={{
            id: "req-2",
            code: "SOL-002",
            status: "draft",
            worksiteId: "ws-1",
            requestType: "epp",
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
          maxFileSizeMb={10}
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
          maxFileSizeMb={10}
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
          maxFileSizeMb={10}
        />,
      )

      fireEvent.click(screen.getByRole("button", { name: "Elegir casco" }))

      expect(screen.getByTestId("item-supplier-0").textContent).toBe("sup-1")
    })
  })
})

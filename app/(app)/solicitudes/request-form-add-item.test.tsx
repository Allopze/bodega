// @vitest-environment jsdom
/**
 * Reproducción: agregar un ítem no puede borrar lo que ya se escribió en el
 * anterior. Se monta el ItemEditor real (el otro archivo de pruebas lo mockea)
 * porque el dato vive en los campos del ítem.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { renderToStaticMarkup } from "react-dom/server"
import { INITIAL_STATE } from "@/lib/form-state"
import type { PropsWithChildren } from "react"
import type { ProductOption } from "./request-form.types"

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
  getWorkerEppStatusAction: vi.fn(async () => ({ activeRequest: null, lastDelivery: null })),
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
  Dialog: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogDescription: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogClose: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))

afterEach(() => cleanup())

const worksites = [{ id: "ws-1", name: "Faena Norte" }]

const products: ProductOption[] = [
  {
    id: "prod-srv-monogas", name: "Mantención de monogás", sku: "SRV-MONOGAS",
    unitOfMeasure: "servicio", isEpp: false, isService: true, requiresWorker: false,
    equipmentKind: "monogas", categoryName: "Servicios", referencePrice: null,
    familyId: null, preferredSupplierId: null, attributes: [],
  },
]

import { RequestForm } from "./request-form"

describe("RequestForm — agregar un ítem", () => {
  it("conserva lo escrito en el ítem anterior", () => {
    render(
      <RequestForm
        worksites={worksites}
        products={products}
        suppliers={[]}
        units={["unidad", "par", "caja"]} maxFileSizeMb={10}
        initialRequestType="otro"
      />,
    )

    // Ítem 1: elegir el servicio y escribir el código del equipo.
    fireEvent.change(screen.getByPlaceholderText(/Buscar en catálogo/), {
      target: { value: "Mantención" },
    })
    fireEvent.mouseDown(screen.getByRole("option", { name: /Mantención de monogás/ }))
    fireEvent.change(screen.getByLabelText(/Código del equipo/), { target: { value: "MG-014" } })
    expect(screen.getByLabelText(/Código del equipo/)).toHaveValue("MG-014")

    // Agregar un segundo ítem no puede tocar el primero.
    fireEvent.click(screen.getByRole("button", { name: /Agregar ítem/ }))

    expect(screen.getByText("Mantención de monogás")).toBeInTheDocument()
    expect(screen.getByLabelText(/Código del equipo/)).toHaveValue("MG-014")
  })

  /**
   * `crypto.randomUUID` sólo existe en contextos seguros. Abriendo la plataforma
   * por `http://<ip-del-servidor>` no está, y la llave del ítem nuevo se genera
   * dentro del updater de `setItems` —fase de render—: la excepción tumbaba el
   * formulario entero y se veía como si se borrara lo escrito.
   */
  it("también sin crypto.randomUUID (contexto no seguro: http:// por IP)", () => {
    const original = globalThis.crypto.randomUUID
    // `randomUUID` vive en el prototipo: se tapa con una propiedad propia.
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true })
    try {
      render(
        <RequestForm
          worksites={worksites}
          products={products}
          suppliers={[]}
          units={["unidad", "par", "caja"]} maxFileSizeMb={10}
          initialRequestType="otro"
        />,
      )

      fireEvent.change(screen.getByPlaceholderText(/Buscar en catálogo/), {
        target: { value: "Mantención" },
      })
      fireEvent.mouseDown(screen.getByRole("option", { name: /Mantención de monogás/ }))
      fireEvent.change(screen.getByLabelText(/Código del equipo/), { target: { value: "MG-014" } })

      fireEvent.click(screen.getByRole("button", { name: /Agregar ítem/ }))

      expect(screen.getAllByText(/Mantención de monogás/).length).toBeGreaterThan(0)
      expect(screen.getByLabelText(/Código del equipo/)).toHaveValue("MG-014")
      expect(screen.getAllByText("2 ítems").length).toBeGreaterThan(0)
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true })
    }
  })

  /**
   * La causa real del reporte "se borran los datos al agregar un ítem": el HTML
   * del servidor se ve y se deja escribir antes de que React hidrate, pero ese
   * texto vive sólo en el DOM. El primer re-render lo repone en blanco. Mientras
   * no monte el cliente el formulario va `inert`, así no se teclea en el vacío.
   */
  it("el formulario llega inerte hasta que hidrata", () => {
    const html = renderToStaticMarkup(
      <RequestForm
        worksites={worksites}
        products={products}
        suppliers={[]}
        units={["unidad", "par", "caja"]} maxFileSizeMb={10}
        initialRequestType="otro"
      />,
    )
    expect(html).toMatch(/<form[^>]*\binert\b/)

    render(
      <RequestForm
        worksites={worksites}
        products={products}
        suppliers={[]}
        units={["unidad", "par", "caja"]} maxFileSizeMb={10}
        initialRequestType="otro"
      />,
    )
    const form = screen.getByRole("button", { name: /Agregar ítem/ }).closest("form")
    expect(form).not.toHaveAttribute("inert")
  })
})

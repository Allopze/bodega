// @vitest-environment jsdom
/**
 * Pedir repuestos con catálogo, de punta a punta en el formulario real (hook,
 * lista de ítems y editor sin mocks): el buscador sobre la descripción, el orden
 * por equipo, el precio que se precarga y lo que viaja al guardar el borrador.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { INITIAL_STATE } from "@/lib/form-state"
import type { PropsWithChildren } from "react"
import type { SparePartOption, VehicleOption } from "./request-form.types"

const saveDraft = vi.fn(async (_prev: unknown, _data: FormData) => INITIAL_STATE)

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("./actions", () => ({
  saveDraft: (prev: unknown, data: FormData) => saveDraft(prev, data),
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

import { RequestForm } from "./request-form"

afterEach(() => cleanup())

beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
    scrollIntoView: () => {},
  })
})

const WORKSITES = [{ id: "ws-1", name: "Biodiversa" }]

const VEHICLES: VehicleOption[] = [
  {
    id: "v-1", code: "KA-135", plate: "RBYD-98", label: "KA-135 · RBYD-98", hint: "Camión · Biodiversa",
    worksiteId: "ws-1", brand: "Scania", model: "R450", operationalStatus: "operativo", openWorkOrders: [],
  },
]

const FILTRO: SparePartOption = {
  id: "rpt-1", sku: "RPT-001", name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "Caterpillar",
  unitOfMeasure: "juego", lastPrice: 35_000, preferredSupplierId: null, purchasedForVehicleIds: [],
}
const PASTILLA: SparePartOption = {
  id: "rpt-2", sku: "RPT-002", name: "Pastilla de freno", partNumber: "PF-200", partBrand: null,
  unitOfMeasure: "unidad", lastPrice: 18_900, preferredSupplierId: null, purchasedForVehicleIds: ["v-1"],
}

function renderForm() {
  return render(
    <RequestForm
      worksites={WORKSITES}
      products={[]}
      spareParts={[FILTRO, PASTILLA]}
      suppliers={[]}
      units={["unidad", "juego"]}
      maxFileSizeMb={10}
      userPermissions={["repuestos:create"]}
      initialRequestType="repuestos"
      initialWorksiteId="ws-1"
      vehicles={VEHICLES}
      quotationThresholdClp={500_000}
    />,
  )
}

async function savedItem() {
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }))
  await waitFor(() => expect(saveDraft).toHaveBeenCalled())
  const data = saveDraft.mock.calls.at(-1)![1]
  return (JSON.parse(String(data.get("itemsJson"))) as Record<string, unknown>[])[0]!
}

describe("RequestForm — repuestos con catálogo", () => {
  it("elige el equipo, sube lo ya comprado para él, precarga el precio y guarda el producto", async () => {
    saveDraft.mockClear()
    renderForm()

    // Equipo de flota: los repuestos comprados para él suben primero.
    fireEvent.focus(screen.getByRole("combobox", { name: /Equipo de flota/ }))
    fireEvent.mouseDown(screen.getByRole("option", { name: /KA-135/ }))
    fireEvent.focus(screen.getByRole("combobox", { name: /Descripción/ }))
    const options = screen.getAllByRole("option")
    expect(options[0]).toHaveTextContent("Pastilla de freno")
    expect(within(options[0]!).getByText("Para este equipo")).toBeInTheDocument()
    expect(options[1]).toHaveTextContent("Filtro de aceite")

    // Elegir el repuesto: ficha de lectura, sin N° de parte libre y con el último precio.
    fireEvent.mouseDown(options[1]!)
    const ficha = screen.getByRole("group", { name: "Repuesto elegido" })
    expect(ficha).toHaveTextContent("Filtro de aceite")
    expect(ficha).toHaveTextContent("RPT-001")
    expect(ficha).toHaveTextContent("1R-0750")
    expect(screen.queryByLabelText(/N° de Parte/)).toBeNull()
    expect(screen.getByLabelText(/Precio unitario estimado/)).toHaveValue(35_000)
    expect(screen.getByLabelText("Unidad")).toHaveValue("juego")

    // El borrador viaja con el producto, sin nombre libre ni N° de parte.
    expect(await savedItem()).toMatchObject({
      productId: "rpt-1", productNameFree: null, partNumber: null, vehicleId: "v-1", estimatedUnitPrice: 35_000, unitOfMeasure: "juego",
    })
  })

  it("«Cambiar» devuelve al buscador y el texto libre sigue guardándose como siempre", async () => {
    saveDraft.mockClear()
    renderForm()

    fireEvent.focus(screen.getByRole("combobox", { name: /Descripción/ }))
    fireEvent.mouseDown(screen.getByRole("option", { name: /Filtro de aceite/ }))
    expect(screen.getByLabelText(/Precio unitario estimado/)).toHaveValue(35_000)

    fireEvent.click(screen.getByRole("button", { name: "Cambiar" }))
    // Lo que había precargado el repuesto se va con él.
    expect(screen.getByLabelText(/Precio unitario estimado/)).toHaveValue(null)

    fireEvent.change(screen.getByPlaceholderText("Describe el ítem requerido..."), { target: { value: "Manguera hidráulica" } })
    fireEvent.change(screen.getByLabelText(/N° de Parte/), { target: { value: "MH-9" } })
    expect(await savedItem()).toMatchObject({
      productId: null, productNameFree: "Manguera hidráulica", partNumber: "MH-9", estimatedUnitPrice: null,
    })
  })
})

// @vitest-environment jsdom
/**
 * El invariante de interfaz de la Guía de Despacho Interna: **el origen no es
 * elegible**. Se muestra como dato fijo —el nombre real de la faena-oficina, no
 * un literal— y no existe ningún control que permita cambiarlo, invertir el
 * traslado (faena → oficina) ni elegir otra oficina.
 */
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    // `useActionState` requiere el runtime de Server Actions; en un test de
    // componente basta con un estado inerte y una acción que no se invoca.
    useActionState: (_action: unknown, initial: unknown) => [initial, vi.fn()],
  }
})

import { GuideForm } from "./guide-form"

const WORKSITES = [
  { id: "ws-faena", name: "Faena Santa Fe" },
  { id: "ws-teno", name: "Faena Teno" },
]

const WORKERS = [
  { id: "w-1", name: "Ana Bodega", rut: "11111111-1", position: null, worksiteId: "ws-oficina", worksiteName: "Administración" },
]

const VEHICLES = [
  { id: "veh-1", plate: "ABCD-12", code: "KA-63", brand: "Toyota", model: "Hilux", responsibleName: "Bodeguero" },
]

const PRODUCTS = [
  { productId: "p-casco", sku: "EPP-001", name: "Casco de seguridad", unitOfMeasure: "unidad", available: 40 },
]

function renderForm() {
  return render(
    <GuideForm
      originWorksiteName="Administración"
      currentUserName="Bodeguero"
      worksites={WORKSITES}
      workers={WORKERS}
      vehicles={VEHICLES}
      products={PRODUCTS}
      action={vi.fn()}
    />,
  )
}

describe("GuideForm — origen fijo", () => {
  it("muestra el origen como dato fijo, sin control para cambiarlo", () => {
    const { container } = renderForm()

    const origin = screen.getByTestId("guide-origin")
    expect(origin).toHaveTextContent("Origen")
    expect(origin).toHaveTextContent("Administración")
    // Un solo nombre: antes el literal "Oficina CHOME" iba encima del nombre
    // real de la faena, una línea más arriba y contradiciéndolo.
    expect(origin).not.toHaveTextContent(/Chome/i)
    // Ningún control dentro del bloque de origen: es texto.
    expect(within(origin).queryAllByRole("combobox")).toHaveLength(0)
    expect(within(origin).queryAllByRole("textbox")).toHaveLength(0)
    expect(within(origin).queryAllByRole("button")).toHaveLength(0)

    // No hay `<select>` nativo en toda la pantalla ni campo de origen que viaje
    // al servidor.
    expect(container.querySelector("select")).toBeNull()
    expect(container.querySelector('[name="originWorksiteId"]')).toBeNull()
    expect(container.querySelector('[name="destinationWorksiteId"]')).not.toBeNull()
  })

  it("el único selector de faena es el de destino y no ofrece la oficina", () => {
    renderForm()
    const destination = screen.getByLabelText(/faena de destino/i)
    fireEvent.focus(destination)

    const options = screen.getAllByRole("option").map((option) => option.textContent)
    expect(options).toEqual(["Faena Santa Fe", "Faena Teno"])
    expect(options.some((label) => label?.includes("Administración"))).toBe(false)
    expect(options.some((label) => label?.includes("Oficina"))).toBe(false)
  })

  it("no permite guardar sin destino ni sin elementos", () => {
    renderForm()
    expect(screen.getByRole("button", { name: /guardar borrador/i })).toBeDisabled()
  })
})

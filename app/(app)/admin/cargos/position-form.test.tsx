// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./actions", () => ({
  createWorkerPositionAction: vi.fn(),
  updateWorkerPositionAction: vi.fn(),
}))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { PositionForm } from "./position-form"
import type { WorkerCapabilityCatalogRow, WorkerPositionCatalogRow } from "./types"

afterEach(cleanup)

const CAPABILITIES: WorkerCapabilityCatalogRow[] = [
  { id: "cap-drive", code: "drives_vehicle", name: "Conduce vehículos", description: "Vehículos livianos", isActive: true, positionCount: 2, overrideCount: 0 },
  { id: "cap-equipment", code: "operates_equipment", name: "Opera equipos", description: null, isActive: true, positionCount: 1, overrideCount: 1 },
]

const OPERADOR: WorkerPositionCatalogRow = {
  id: "pos-operador",
  code: "OPERADOR",
  name: "Operador",
  isActive: true,
  needsReview: true,
  isSystem: false,
  requiredLicenseClasses: [],
  workerCount: 4,
  aliases: [],
  capabilities: [{ id: "cap-equipment", code: "operates_equipment", name: "Opera equipos" }],
}

/** Todo lo que el formulario enviaría al servidor, igual que `<form action>`. */
function submittedForm() {
  const form = screen.getByRole("dialog").querySelector("form")!
  return new FormData(form)
}

/**
 * La opción por su código («A4», «A2 antigua»). No se busca por nombre accesible:
 * jsdom no aplica CSS, así que el código y la descripción —dos `span` que en el
 * navegador son ítems de un flex— se pegan sin espacio y el nombre sale «A4Transporte…».
 */
function chip(code: string) {
  return screen.getByText(code, { selector: "button span" }).closest("button")!
}

describe("PositionForm", () => {
  it("permite revisar identidad, capacidades y estado del cargo", () => {
    render(<PositionForm open onClose={vi.fn()} capabilities={CAPABILITIES} editPosition={OPERADOR} />)

    expect(screen.getByRole("dialog", { name: "Revisar cargo" })).toBeTruthy()
    expect(screen.getByRole("textbox", { name: /Código/ })).toHaveValue("OPERADOR")
    expect(screen.getByRole("textbox", { name: /Nombre del cargo/ })).toHaveValue("Operador")
    expect(screen.getByLabelText(/Conduce vehículos/)).not.toBeChecked()
    expect(screen.getByLabelText(/Opera equipos/)).toBeChecked()
    expect(screen.getByLabelText("Cargo pendiente de revisión")).toBeChecked()
  })

  it("ofrece las clases de licencia con su ayuda y las marca según el cargo", () => {
    render(
      <PositionForm
        open
        onClose={vi.fn()}
        capabilities={CAPABILITIES}
        editPosition={{ ...OPERADOR, requiredLicenseClasses: ["A4", "A5"] }}
      />,
    )

    const group = screen.getByRole("group", { name: "Licencia de conducir" })
    expect(within(group).getAllByRole("button")).toHaveLength(12)
    expect(chip("A4")).toHaveAttribute("aria-pressed", "true")
    expect(chip("A5")).toHaveAttribute("aria-pressed", "true")
    expect(chip("B")).toHaveAttribute("aria-pressed", "false")
    // La ayuda explica la regla «basta una» y que vacío es válido…
    expect(screen.getByText(/Basta con que tenga una de las marcadas/)).toBeTruthy()
    expect(screen.getByText(/Déjalo vacío si el cargo no exige una clase en particular/)).toBeTruthy()
    // …y está enlazada al grupo, no suelta.
    expect(group.getAttribute("aria-describedby")).toBeTruthy()
  })

  it("envía las clases marcadas con name=requiredLicenseClasses, una por valor", () => {
    render(<PositionForm open onClose={vi.fn()} capabilities={CAPABILITIES} editPosition={OPERADOR} />)

    fireEvent.click(chip("D"))
    fireEvent.click(chip("B"))

    // `getAll` es lo que lee la acción. Se descartan los vacíos (marca del campo).
    expect(submittedForm().getAll("requiredLicenseClasses").filter(Boolean)).toEqual(["B", "D"])
  })

  it("sin ninguna clase marcada igual envía el campo, para que la acción pueda vaciarlo", () => {
    render(
      <PositionForm
        open
        onClose={vi.fn()}
        capabilities={CAPABILITIES}
        editPosition={{ ...OPERADOR, requiredLicenseClasses: ["A4"] }}
      />,
    )

    fireEvent.click(chip("A4"))

    expect(submittedForm().getAll("requiredLicenseClasses").filter(Boolean)).toEqual([])
    // Presente (aunque vacío): distingue «borrar todas» de «formulario sin el campo».
    expect(submittedForm().has("requiredLicenseClasses")).toBe(true)
  })

  it("un cargo nuevo parte sin clases marcadas", () => {
    render(<PositionForm open onClose={vi.fn()} capabilities={CAPABILITIES} />)

    expect(screen.getByRole("dialog", { name: "Nuevo cargo" })).toBeTruthy()
    for (const code of ["A1", "A4", "A5", "B", "D"]) {
      expect(chip(code)).toHaveAttribute("aria-pressed", "false")
    }
    expect(submittedForm().getAll("requiredLicenseClasses").filter(Boolean)).toEqual([])
  })
})

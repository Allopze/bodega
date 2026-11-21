// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PersonalUsePeriod } from "@/lib/fleet/personal-use"
import { VehicleFichaPersonalUseBadge } from "../_ficha/ficha-chrome"
import { VehiclePersonalUseCard } from "./vehicle-personal-use-card"

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  toastSuccess: vi.fn(),
}))
vi.mock("../../actions", () => ({
  savePersonalUsePeriodAction: mocks.save,
  deletePersonalUsePeriodAction: mocks.remove,
}))
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.toastSuccess, error: vi.fn() } }))
// «Editar vehículo» pide el formulario al abrirse; su acción trae la base de datos consigo.
vi.mock("../_ficha/vehicle-edit-button", () => ({ VehicleEditButton: () => null }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

const TODAY = "2026-11-20"

// Más reciente primero, como lo entrega `listPersonalUsePeriods`.
const closed: PersonalUsePeriod = { id: "p1", vehicleId: "veh-1", startedOn: "2026-10-12", endedOn: "2026-10-19", note: "Viaje del dueño" }
const open: PersonalUsePeriod = { id: "p2", vehicleId: "veh-1", startedOn: "2026-11-03", endedOn: null, note: null }

function renderCard(props: Partial<React.ComponentProps<typeof VehiclePersonalUseCard>> = {}) {
  return render(
    <VehiclePersonalUseCard vehicleId="veh-1" periods={[open, closed]} canMark today={TODAY} {...props} />,
  )
}

describe("VehiclePersonalUseCard · tarjeta de la ficha", () => {
  it("lista los períodos con el formato exacto y la nota", () => {
    renderCard({ periods: [closed, { ...open, startedOn: "2026-11-03", endedOn: "2026-11-05" }] })

    const items = within(screen.getByRole("list")).getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(items[0]!.textContent).toContain("12-10-2026 → 19-10-2026")
    expect(items[0]!.textContent).toContain("Viaje del dueño")
    expect(items[1]!.textContent).toContain("03-11-2026 → 05-11-2026")
  })

  it("un período abierto dice «(en curso)»", () => {
    renderCard()

    const items = within(screen.getByRole("list")).getAllByRole("listitem")
    expect(items[0]!.textContent).toContain("03-11-2026 → (en curso)")
  })

  it("sin permiso no hay botones para marcar, editar ni quitar", () => {
    renderCard({ canMark: false })

    expect(screen.getByRole("heading", { name: "Uso personal" })).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("sin períodos explica qué significa y ofrece marcar uno", async () => {
    renderCard({ periods: [] })

    expect(screen.getByText("Este equipo no tiene uso personal marcado")).toBeInTheDocument()
    expect(screen.queryByRole("list")).toBeNull()
    // Un solo «Marcar uso personal»: el del estado vacío es el que abre la hoja.
    fireEvent.click(screen.getByRole("button", { name: "Marcar uso personal" }))
    expect(await screen.findByRole("dialog", { name: "Marcar uso personal" })).toBeInTheDocument()
  })

  it("sin períodos y sin permiso el estado vacío no ofrece nada que no pueda hacer", () => {
    renderCard({ periods: [], canMark: false })

    expect(screen.getByText("Este equipo no tiene uso personal marcado")).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("«Marcar uso personal» abre la hoja con Desde en hoy y Hasta vacío, con su ayuda", async () => {
    renderCard()

    fireEvent.click(screen.getByRole("button", { name: "Marcar uso personal" }))
    const dialog = await screen.findByRole("dialog", { name: "Marcar uso personal" })

    const data = new FormData(dialog.querySelector("form")!)
    expect(data.get("vehicleId")).toBe("veh-1")
    expect(data.get("id")).toBe("")
    expect(data.get("startedOn")).toBe(TODAY)
    expect(data.get("endedOn")).toBe("")
    expect(within(dialog).getByText("Déjalo vacío si el equipo aún no vuelve")).toBeInTheDocument()
  })

  it("«Editar» abre la hoja con los datos del período", async () => {
    renderCard()

    fireEvent.click(screen.getByRole("button", { name: /^Editar 12-10-2026/ }))
    const dialog = await screen.findByRole("dialog", { name: "Editar uso personal" })

    const data = new FormData(dialog.querySelector("form")!)
    expect(data.get("id")).toBe("p1")
    expect(data.get("startedOn")).toBe("2026-10-12")
    expect(data.get("endedOn")).toBe("2026-10-19")
    expect(data.get("note")).toBe("Viaje del dueño")
  })

  it("«Quitar» pide confirmar, explica que las cifras vuelven a contar y borra por id", async () => {
    mocks.remove.mockResolvedValue({ ok: true, message: "Uso personal quitado" })
    renderCard()

    fireEvent.click(screen.getByRole("button", { name: /^Quitar 12-10-2026/ }))
    const dialog = await screen.findByRole("dialog")
    expect(dialog.textContent).toContain("12-10-2026 → 19-10-2026")
    expect(dialog.textContent).toMatch(/vuelven a contar/)
    expect(mocks.remove).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole("button", { name: "Quitar" }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("p1"))
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Uso personal quitado"))
  })

  it("si quitar falla, el motivo se queda dentro del diálogo", async () => {
    mocks.remove.mockResolvedValue({ ok: false, message: "El período ya no existe: recarga la ficha." })
    renderCard()

    fireEvent.click(screen.getByRole("button", { name: /^Quitar 12-10-2026/ }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Quitar" }))

    expect(await within(dialog).findByText("El período ya no existe: recarga la ficha.")).toBeInTheDocument()
  })
})

describe("VehicleFichaPersonalUseBadge · insignia de la cabecera", () => {
  it("aparece sólo con un período abierto", () => {
    render(<VehicleFichaPersonalUseBadge periods={[open, closed]} />)

    expect(screen.getByText("En uso personal")).toBeInTheDocument()
  })

  it("no aparece si todos los períodos terminaron o no hay ninguno", () => {
    const { rerender, container } = render(<VehicleFichaPersonalUseBadge periods={[closed]} />)
    expect(screen.queryByText("En uso personal")).toBeNull()

    rerender(<VehicleFichaPersonalUseBadge periods={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

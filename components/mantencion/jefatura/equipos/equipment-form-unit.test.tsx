// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { EMPTY_EQUIPMENT_VALUES, type EquipmentFormCatalogs, type EquipmentFormValues } from "./equipment-form-types"
import type { ActionState } from "@/lib/validation/operations"

/*
 * La unidad de un equipo se pregunta al darlo de alta (decisión del usuario, 2026-11-26): el control «Unidad de
 * mantención» parte con la de su TIPO y se puede cambiar. Las pautas que se ofrecen y la lectura inicial siguen la
 * unidad elegida, no la del tipo. Ya no hay una regla por faena: la misma pareja tipo y faena da lo mismo siempre.
 */

// Radix Select las usa al abrir una lista; jsdom no las trae.
Element.prototype.scrollIntoView = function scrollIntoView() {}
Element.prototype.hasPointerCapture = () => false
Element.prototype.releasePointerCapture = () => {}

vi.mock("@/lib/toast", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const { EquipmentForm } = await import("./equipment-form")

const CATALOGS: EquipmentFormCatalogs = {
  types: [
    { id: "t-camion", name: "Camión", unit: "km" },
    { id: "t-excavadora", name: "Excavadora", unit: "h" },
  ],
  brands: [{ id: "b1", name: "Volvo" }],
  worksites: [
    { id: "w-sf", name: "Santa Fe" },
    { id: "w-bio", name: "Biodiversa" },
  ],
  schedules: [
    { id: "s-km", name: "Camiones y tractos", unit: "km", intervalCount: 5 },
    { id: "s-h", name: "Maquinaria pesada", unit: "h", intervalCount: 4 },
  ],
}

afterEach(cleanup)

const renderForm = (overrides: Partial<EquipmentFormValues> = {}, action: (prev: ActionState, formData: FormData) => Promise<ActionState> = vi.fn(async () => ({ ok: false }))) =>
  render(<EquipmentForm action={action} catalogs={CATALOGS} initial={{ ...EMPTY_EQUIPMENT_VALUES, ...overrides }} submitLabel="Crear equipo" />)

const unitControl = () => screen.getByRole("combobox", { name: /^Unidad de mantención/ })
const hidden = (container: HTMLElement, name: string) => container.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)

async function pick(control: HTMLElement, option: RegExp | string) {
  fireEvent.click(control)
  await act(async () => { fireEvent.click(await screen.findByRole("option", { name: option })) })
}

describe("«Nuevo equipo»: la unidad de mantención se pregunta y parte con la del tipo", () => {
  it("un tipo de odómetro prellena kilómetros: ofrece pautas y lectura inicial en kilómetros", () => {
    const { container } = renderForm({ equipmentTypeId: "t-camion", worksiteId: "w-sf" })
    expect(unitControl().textContent).toContain("Kilómetros")
    expect(hidden(container, "unit")?.value).toBe("km")
    expect(screen.getByText(/El tipo se mide en kilómetros\. Cámbiala si este equipo se mide distinto\./)).toBeTruthy()
    expect(screen.getByText(/Sólo aparecen pautas en kilómetros\./)).toBeTruthy()
    expect(screen.getByLabelText("Lectura inicial (km)")).toBeTruthy()
  })

  it("un tipo de horómetro prellena horas", () => {
    const { container } = renderForm({ equipmentTypeId: "t-excavadora", worksiteId: "w-bio" })
    expect(unitControl().textContent).toContain("Horas")
    expect(hidden(container, "unit")?.value).toBe("h")
    expect(screen.getByText(/Sólo aparecen pautas en horas\./)).toBeTruthy()
    expect(screen.getByLabelText("Lectura inicial (h)")).toBeTruthy()
  })

  it("la faena no entra en la cuenta: el mismo tipo da la misma unidad en Biodiversa y fuera de ella", () => {
    for (const worksiteId of ["w-bio", "w-sf"]) {
      const { container, unmount } = renderForm({ equipmentTypeId: "t-camion", worksiteId })
      expect(hidden(container, "unit")?.value).toBe("km")
      unmount()
    }
  })

  it("sin tipo elegido el control está deshabilitado y lo avisa", () => {
    renderForm()
    expect((unitControl() as HTMLButtonElement).disabled).toBe(true)
    // La unidad y la pauta dependen del tipo: las dos ayudas lo dicen.
    expect(screen.getAllByText("Elige primero el tipo de equipo.", { selector: "p" })).toHaveLength(2)
  })

  it("elegir otra unidad cambia las pautas y la lectura, y la ayuda dice que difiere del tipo", async () => {
    const { container } = renderForm({ equipmentTypeId: "t-camion", worksiteId: "w-sf" })
    await pick(unitControl(), "Horas")
    expect(hidden(container, "unit")?.value).toBe("h")
    expect(screen.getByText(/El tipo se mide en kilómetros; este equipo se mide en horas\./)).toBeTruthy()
    expect(screen.getByText(/Sólo aparecen pautas en horas\./)).toBeTruthy()
    expect(screen.getByLabelText("Lectura inicial (h)")).toBeTruthy()
    fireEvent.click(screen.getByRole("combobox", { name: /^Pauta de mantención/ }))
    expect(await screen.findByRole("option", { name: /Maquinaria pesada/ })).toBeTruthy()
    expect(screen.queryByRole("option", { name: /Camiones y tractos/ })).toBeNull()
  })

  it("una pauta ya elegida que no calza con la unidad nueva se suelta", async () => {
    const { container } = renderForm({ equipmentTypeId: "t-camion", worksiteId: "w-sf", scheduleId: "s-km" })
    expect(hidden(container, "scheduleId")?.value).toBe("s-km")
    await pick(unitControl(), "Horas")
    await waitFor(() => expect(hidden(container, "scheduleId")?.value).toBe(""))
  })

  it("cambiar el tipo devuelve la unidad a la del tipo nuevo", async () => {
    const { container } = renderForm({ equipmentTypeId: "t-camion", worksiteId: "w-sf" })
    await pick(unitControl(), "Horas")
    expect(hidden(container, "unit")?.value).toBe("h")
    await pick(screen.getByRole("combobox", { name: /^Tipo de equipo/ }), "Excavadora")
    expect(hidden(container, "unit")?.value).toBe("h")
    await pick(screen.getByRole("combobox", { name: /^Tipo de equipo/ }), "Camión")
    expect(hidden(container, "unit")?.value).toBe("km")
  })

  it("envía la unidad elegida con el formulario, para que el servidor la valide", async () => {
    const action = vi.fn(async () => ({ ok: false } as ActionState))
    renderForm({ code: "KA-1", equipmentTypeId: "t-camion", worksiteId: "w-sf", brandId: "b1" }, action)
    await pick(unitControl(), "Horas")
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "Crear equipo" }).closest("form")!) })
    const data = (action.mock.calls[0] as unknown as [unknown, FormData])[1]
    expect(data.get("unit")).toBe("h")
    expect(data.get("equipmentTypeId")).toBe("t-camion")
  })

  it("el error del servidor sobre la unidad se ve bajo el campo", async () => {
    renderForm(
      { equipmentTypeId: "t-camion", worksiteId: "w-sf" },
      vi.fn(async () => ({ ok: false, message: "Elige la unidad de mantención: kilómetros u horas.", fieldErrors: { unit: ["Elige la unidad de mantención: kilómetros u horas."] } } as ActionState)),
    )
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "Crear equipo" }).closest("form")!) })
    expect(screen.getAllByText("Elige la unidad de mantención: kilómetros u horas.")).toHaveLength(1)
    expect(unitControl().getAttribute("aria-invalid")).toBe("true")
  })
})

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import type { ActionState } from "@/lib/validation/operations"
import { EMPTY_EQUIPMENT_VALUES, type EquipmentFormCatalogs } from "./equipment-form-types"

/*
 * EQ-1 (auditoría de Mantención 2026-11-22): un error que sólo trae mensaje —«La ficha cambió
 * mientras la editabas», «faena que no administras»— no se veía: el aviso general exigía
 * `!state.fieldErrors` y la acción devolvía siempre un objeto. Los dos formularios muestran el
 * mensaje cuando no hay error de campo, y los errores de campo siguen marcando su campo.
 */

vi.mock("@/lib/toast", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const { EquipmentPlanForm } = await import("./equipment-plan-form")
const { EquipmentForm } = await import("./equipment-form")

const CATALOGS: EquipmentFormCatalogs = {
  types: [{ id: "t-km", name: "Camión", unit: "km" }],
  brands: [{ id: "b1", name: "Volvo" }],
  worksites: [{ id: "w1", name: "Biodiversa" }],
  schedules: [{ id: "s-km", name: "Camiones y tractos", unit: "km", intervalCount: 3 }],
}
const PLAN_INITIAL = { scheduleId: "s-km", initialReading: "", initialReadingDate: "", retired: false, retiredReason: "" }

const CONCURRENT = "La ficha cambió mientras la editabas. Recarga la página y vuelve a intentarlo."

async function submit(button: string) {
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: button }).closest("form")!) })
}

describe("«Editar plan de mantención»: el error sin campo se ve", () => {
  const renderPlan = (state: ActionState) => render(
    <EquipmentPlanForm
      action={vi.fn(async () => state)} vehicleId="veh-9" unit="km" schedules={CATALOGS.schedules}
      initial={PLAN_INITIAL} readingLocked={false} onCancel={vi.fn()} onSaved={vi.fn()}
    />,
  )

  it("con `fieldErrors` indefinido muestra el mensaje general", async () => {
    renderPlan({ ok: false, message: CONCURRENT, fieldErrors: undefined })
    await submit("Guardar cambios")
    expect(screen.getByRole("alert").textContent).toContain(CONCURRENT)
  })

  it("con un `{}` (acciones viejas) también lo muestra", async () => {
    renderPlan({ ok: false, message: CONCURRENT, fieldErrors: {} })
    await submit("Guardar cambios")
    expect(screen.getByRole("alert").textContent).toContain(CONCURRENT)
  })

  it("con un error de campo lo marca en su campo y no repite el aviso general", async () => {
    renderPlan({ ok: false, message: "Escribe una lectura válida.", fieldErrors: { initialReading: ["Escribe una lectura válida."] } })
    await submit("Guardar cambios")
    expect(screen.getAllByText("Escribe una lectura válida.")).toHaveLength(1)
    expect((screen.getByLabelText(/^Lectura inicial/) as HTMLInputElement).getAttribute("aria-invalid")).toBe("true")
  })
})

describe("«Nuevo equipo»: el error sin campo se ve", () => {
  const renderForm = (state: ActionState) => render(
    <EquipmentForm action={vi.fn(async () => state)} catalogs={CATALOGS} initial={EMPTY_EQUIPMENT_VALUES} submitLabel="Crear equipo" />,
  )

  it("con `fieldErrors` indefinido muestra el mensaje general", async () => {
    renderForm({ ok: false, message: "Ese equipo es de una faena que no administras.", fieldErrors: undefined })
    await submit("Crear equipo")
    expect(screen.getByRole("alert").textContent).toContain("faena que no administras")
  })

  it("con un error de campo, el mensaje va en el campo", async () => {
    renderForm({ ok: false, message: "Escribe el código interno.", fieldErrors: { code: ["Escribe el código interno."] } })
    await submit("Crear equipo")
    expect(screen.getAllByText("Escribe el código interno.")).toHaveLength(1)
  })
})

describe("EQN-4: el rótulo y la ayuda de la lectura", () => {
  it("se llama «Lectura inicial» y la ayuda ya no promete calcular sin preventiva", () => {
    render(
      <EquipmentPlanForm
        action={vi.fn(async () => ({ ok: false } as ActionState))} vehicleId="veh-9" unit="km" schedules={CATALOGS.schedules}
        initial={PLAN_INITIAL} readingLocked={false} onCancel={vi.fn()} onSaved={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/^Lectura inicial \(km\)/)).toBeDefined()
    expect(screen.queryByLabelText(/^Lectura actual/)).toBeNull()
    expect(screen.getByText(/Con la lectura inicial y una preventiva \(firmada o declarada\) se calcula la próxima mantención/)).toBeDefined()
    expect(screen.queryByText(/antes del primer registro/)).toBeNull()
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ShiftForm } from "./shift-form"

const actions = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }))
vi.mock("./actions", () => ({ createShiftAction: actions.create, updateShiftAction: actions.update }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const VEHICLES = [
  { id: "veh-1", code: "GR-11", hasVisionLink: true },
  { id: "veh-2", code: "KA-71", hasVisionLink: false },
]
const OPERATORS = [{ id: "wrk-1", name: "Ana Pérez", isMachineOperator: true }]

function renderForm(overrides: Partial<React.ComponentProps<typeof ShiftForm>> = {}) {
  return render(
    <ShiftForm
      day="2026-11-19" vehicles={VEHICLES} operators={OPERATORS} editing={null}
      open onOpenChange={vi.fn()} onEditDone={vi.fn()} {...overrides}
    />,
  )
}

const combo = (name: string) => screen.getByRole("combobox", { name })
function choose(name: string, option: string) {
  fireEvent.click(combo(name))
  fireEvent.click(screen.getByRole("option", { name: option }))
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup() })

describe("ShiftForm", () => {
  it("elegir «Noche 22–06» deja Inicio en 22:00 y Fin en 06:00", () => {
    renderForm()
    choose("Turno", "Noche 22–06")
    expect(combo("Inicio").textContent).toContain("22:00")
    expect(combo("Fin").textContent).toContain("06:00")
    expect(combo("Turno").textContent).toContain("Noche 22–06")
  })

  it("cambiar el Fin a 07 a mano deja el turno en «Otro horario»", () => {
    renderForm()
    choose("Turno", "Noche 22–06")
    choose("Fin", "07:00")
    expect(combo("Turno").textContent).toContain("Otro horario")
    expect(combo("Inicio").textContent).toContain("22:00")
    expect(combo("Fin").textContent).toContain("07:00")
  })

  it("si las horas elegidas a mano calzan con un turno predefinido, vuelve a mostrarlo", () => {
    renderForm()
    choose("Turno", "Noche 22–06")
    choose("Fin", "07:00")
    choose("Fin", "06:00")
    expect(combo("Turno").textContent).toContain("Noche 22–06")
  })

  it("avisa que el turno de noche se registra con la fecha en que comienza", () => {
    renderForm()
    expect(screen.getByText("El turno de noche se registra con la fecha en que comienza.")).toBeTruthy()
  })

  it("sin completar los campos no llama a la acción y marca lo que falta", () => {
    renderForm()
    fireEvent.click(screen.getByRole("button", { name: "Guardar turno" }))
    expect(actions.create).not.toHaveBeenCalled()
    expect(screen.getByText("Elige el equipo.")).toBeTruthy()
    expect(screen.getByText("Elige el operador.")).toBeTruthy()
  })

  it("registra el turno del día con las horas del turno elegido", async () => {
    actions.create.mockResolvedValue({ ok: true, shiftId: "s-1" })
    renderForm()
    fireEvent.focus(screen.getByRole("combobox", { name: "Equipo" }))
    fireEvent.mouseDown(screen.getByRole("option", { name: /GR-11/ }))
    choose("Turno", "Noche 22–06")
    fireEvent.focus(screen.getByRole("combobox", { name: "Operador" }))
    fireEvent.mouseDown(screen.getByRole("option", { name: /Ana Pérez/ }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar turno" }))
    await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(1))
    expect(actions.create).toHaveBeenCalledWith({
      vehicleId: "veh-1", shiftDate: "2026-11-19", startHour: 22, endHour: 6, operatorWorkerId: "wrk-1", notes: "",
    })
  })

  it("al editar parte con los valores del turno y guarda con su id", async () => {
    actions.update.mockResolvedValue({ ok: true, shiftId: "s-9" })
    const onEditDone = vi.fn()
    renderForm({
      editing: {
        id: "s-9", vehicleId: "veh-1", vehicleCode: "GR-11", shiftDate: "2026-11-19", startHour: 6, endHour: 14,
        presetLabel: "Mañana 06–14", operatorWorkerId: "wrk-1", operatorName: "Ana Pérez", notes: "", summary: {} as never,
      },
      onEditDone,
    })
    expect(combo("Turno").textContent).toContain("Mañana 06–14")
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(actions.update).toHaveBeenCalledTimes(1))
    expect(actions.update).toHaveBeenCalledWith("s-9", expect.objectContaining({ vehicleId: "veh-1", startHour: 6, endHour: 14 }))
    await waitFor(() => expect(onEditDone).toHaveBeenCalled())
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("./actions", () => ({ bulkAssignWorkerPositionAction: mocks.action }))
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))

import { BulkAssignDialog, type AssignablePosition } from "./bulk-assign-dialog"

const CONDUCTOR: AssignablePosition = {
  id: "pos-conductor",
  name: "Conductor de camión",
  needsReview: false,
  aliases: ["Chofer", "Conductor"],
  capabilities: [{ id: "cap-drive", name: "Conduce vehículos" }],
  drives: true,
  requiredLicenseClasses: ["A4", "A5"],
}

const AUXILIAR: AssignablePosition = {
  id: "pos-auxiliar",
  name: "Auxiliar",
  needsReview: false,
  aliases: ["Peoneta"],
  capabilities: [],
  drives: false,
  requiredLicenseClasses: [],
}

const OPERADOR: AssignablePosition = {
  id: "pos-operador",
  name: "Operador de maquinaria",
  needsReview: true,
  aliases: [],
  capabilities: [
    { id: "cap-equipment", name: "Opera equipos" },
    { id: "cap-drive", name: "Conduce vehículos" },
  ],
  drives: true,
  requiredLicenseClasses: [],
}

const WORKERS = [
  { id: "w-1", hasDriverLicense: true },
  { id: "w-2", hasDriverLicense: false },
  { id: "w-3", hasDriverLicense: false },
]

function setup(overrides: Partial<ComponentProps<typeof BulkAssignDialog>> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    workers: WORKERS,
    positions: [CONDUCTOR, AUXILIAR, OPERADOR],
    onAssigned: vi.fn(),
    ...overrides,
  }
  render(<BulkAssignDialog {...props} />)
  return props
}

function chooseCargo(name: RegExp | string) {
  const combobox = screen.getByRole("combobox", { name: "Cargo" })
  fireEvent.focus(combobox)
  fireEvent.mouseDown(screen.getByRole("option", { name }))
}

beforeEach(() => {
  mocks.action.mockResolvedValue({ ok: true, message: "3 trabajadores clasificados como Conductor de camión." })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("BulkAssignDialog — qué implica el cargo", () => {
  it("antes de elegir no promete nada y no deja confirmar", () => {
    setup()

    expect(screen.getByText(/Elige un cargo para ver qué implica/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Asignar a 3" })).toBeDisabled()
  })

  it("dice la capacidad y la licencia que exige el cargo, con las clases formateadas", () => {
    setup()
    chooseCargo(/Conductor de camión/)

    expect(screen.getByText("Conduce vehículos · exige licencia A4 o A5")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Asignar a 3" })).toBeEnabled()
  })

  it("anticipa cuántos quedarán sin licencia registrada en Conductores", () => {
    setup()
    chooseCargo(/Conductor de camión/)

    expect(screen.getByText(/Pasarán a Conductores/)).toBeTruthy()
    // w-2 y w-3 no tienen licencia; w-1 sí.
    expect(screen.getByText("2 sin licencia registrada.")).toBeTruthy()
  })

  it("si todos ya tienen licencia lo dice en vez de contar cero", () => {
    setup({ workers: [{ id: "w-1", hasDriverLicense: true }, { id: "w-4", hasDriverLicense: true }] })
    chooseCargo(/Conductor de camión/)

    expect(screen.getByText(/todos tienen licencia registrada/)).toBeTruthy()
    expect(screen.queryByText(/sin licencia registrada\./)).toBeNull()
  })

  it("un cargo que conduce sin exigir clase igual los manda a Conductores", () => {
    setup()
    chooseCargo(/Operador de maquinaria/)

    expect(screen.getByText("Opera equipos · Conduce vehículos")).toBeTruthy()
    expect(screen.getByText(/Pasarán a Conductores/)).toBeTruthy()
    expect(screen.getByText("Por revisar")).toBeTruthy()
  })

  it("un cargo que no conduce avisa que no entrarán a Conductores", () => {
    setup()
    chooseCargo(/Auxiliar/)

    expect(screen.getByText(/Sin capacidades ni exigencia de licencia/)).toBeTruthy()
    expect(screen.getByText(/No conduce ni opera maquinaria/)).toBeTruthy()
    expect(screen.queryByText(/Pasarán a Conductores/)).toBeNull()
  })

  it("encuentra el cargo por el nombre con que lo conoce la planilla", () => {
    setup()
    const combobox = screen.getByRole("combobox", { name: "Cargo" })
    fireEvent.focus(combobox)
    fireEvent.change(combobox, { target: { value: "peoneta" } })

    expect(screen.getByRole("option", { name: /Auxiliar/ })).toBeTruthy()
    expect(screen.queryByRole("option", { name: /Conductor de camión/ })).toBeNull()
  })
})

describe("BulkAssignDialog — asignar", () => {
  it("manda la selección, el cargo y el motivo; avisa con un toast y cierra", async () => {
    const props = setup()
    chooseCargo(/Conductor de camión/)
    fireEvent.change(screen.getByRole("textbox", { name: "Motivo (opcional)" }), {
      target: { value: "Según la planilla de licencias" },
    })

    fireEvent.click(screen.getByRole("button", { name: "Asignar a 3" }))

    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(1))
    expect(mocks.action).toHaveBeenCalledWith({
      workerIds: ["w-1", "w-2", "w-3"],
      positionId: "pos-conductor",
      reason: "Según la planilla de licencias",
    })
    await waitFor(() => expect(props.onAssigned).toHaveBeenCalledWith(["w-1", "w-2", "w-3"]))
    expect(mocks.toastSuccess).toHaveBeenCalledWith("3 trabajadores clasificados como Conductor de camión.")
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("el motivo es opcional: sin escribirlo igual se puede asignar", async () => {
    setup()
    chooseCargo(/Auxiliar/)

    fireEvent.click(screen.getByRole("button", { name: "Asignar a 3" }))

    await waitFor(() => expect(mocks.action).toHaveBeenCalledWith({
      workerIds: ["w-1", "w-2", "w-3"],
      positionId: "pos-auxiliar",
      reason: "",
    }))
  })

  it("si el servidor rechaza, deja el diálogo abierto y muestra por qué", async () => {
    mocks.action.mockResolvedValue({ ok: false, message: "No tienes acceso a la faena de 1 de los trabajadores seleccionados." })
    const props = setup()
    chooseCargo(/Conductor de camión/)

    fireEvent.click(screen.getByRole("button", { name: "Asignar a 3" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("No tienes acceso a la faena de 1 de los trabajadores seleccionados.")
    expect(props.onAssigned).not.toHaveBeenCalled()
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    // Sigue pudiendo corregir y reintentar.
    await waitFor(() => expect(screen.getByRole("button", { name: "Asignar a 3" })).toBeEnabled())
  })

  it("cancelar cierra sin llamar al servidor", () => {
    const props = setup()
    chooseCargo(/Conductor de camión/)

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }))

    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(mocks.action).not.toHaveBeenCalled()
  })
})

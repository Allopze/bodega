// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { PdtpObjective } from "@/lib/services/prevention-pdtp"
import type { PdtpActivityRow } from "./tabs/types"
import { ObjetivosTab } from "./builder-tabs"

const { mockUpsert, mockDelete, mockReorder, mockRefresh } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockDelete: vi.fn(),
  mockReorder: vi.fn(),
  mockRefresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }) }))
vi.mock("../../actions", () => ({
  upsertPdtpObjectiveAction: mockUpsert,
  deletePdtpObjectiveAction: mockDelete,
  reorderPdtpObjectivesAction: mockReorder,
}))

function makeObjective(overrides: Partial<PdtpObjective> = {}): PdtpObjective {
  return {
    id: "objective-1",
    programId: "program-1",
    code: "1",
    name: "FORTALECER EL LIDERAZGO DE SEGURIDAD Y SALUD EN EL TRABAJO",
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as PdtpObjective
}

function makeActivity(overrides: Partial<PdtpActivityRow> = {}): PdtpActivityRow {
  return {
    id: "act-1",
    n: 1,
    activity: "Actividad de prueba",
    objectiveId: null,
    status: "active",
    ...overrides,
  } as unknown as PdtpActivityRow
}

beforeEach(() => {
  mockUpsert.mockResolvedValue({ ok: true, objectiveId: "objective-new" })
  mockDelete.mockResolvedValue({ ok: true })
  mockReorder.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ObjetivosTab", () => {
  it("renderiza los objetivos ordenados con el conteo de actividades por objetivo", () => {
    const objectives = [
      makeObjective({ id: "objective-1", code: "1", name: "Objetivo uno", displayOrder: 0 }),
      makeObjective({ id: "objective-2", code: "2", name: "Objetivo dos", displayOrder: 1 }),
    ]
    const activities = [
      makeActivity({ id: "act-1", objectiveId: "objective-1" }),
      makeActivity({ id: "act-2", objectiveId: "objective-1" }),
      makeActivity({ id: "act-3", objectiveId: "objective-2" }),
      makeActivity({ id: "act-4", objectiveId: null }),
    ]
    render(<ObjetivosTab programId="program-1" objectives={objectives} activities={activities} />)

    const rows = screen.getAllByRole("row").slice(1) // sin la fila de cabecera
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("1")
    expect(rows[0]).toHaveTextContent("Objetivo uno")
    expect(rows[0]).toHaveTextContent("2 actividades")
    expect(rows[1]).toHaveTextContent("2")
    expect(rows[1]).toHaveTextContent("Objetivo dos")
    expect(rows[1]).toHaveTextContent("1 actividad")

    expect(screen.getByText(/1 actividad sin objetivo asignado todavía/)).toBeInTheDocument()
  })

  it("muestra un estado vacío cuando el programa no tiene objetivos", () => {
    render(<ObjetivosTab programId="program-1" objectives={[]} activities={[]} />)
    expect(screen.getByText("Sin objetivos definidos")).toBeInTheDocument()
  })

  it("el botón «Agregar objetivo» abre el formulario con código y nombre vacíos", () => {
    render(<ObjetivosTab programId="program-1" objectives={[]} activities={[]} />)

    fireEvent.click(screen.getByRole("button", { name: "Agregar objetivo" }))

    expect(screen.getByRole("dialog", { name: "Agregar objetivo" })).toBeInTheDocument()
    expect(screen.getByLabelText(/Código/)).toHaveValue("")
    expect(screen.getByLabelText(/Nombre/)).toHaveValue("")
  })

  it("guardar el formulario llama a upsertPdtpObjectiveAction con el código y nombre ingresados", async () => {
    render(<ObjetivosTab programId="program-1" objectives={[]} activities={[]} />)

    fireEvent.click(screen.getByRole("button", { name: "Agregar objetivo" }))
    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: "9" } })
    fireEvent.change(screen.getByLabelText(/Nombre/), { target: { value: "Objetivo nuevo" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    await vi.waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1))
    expect(mockUpsert).toHaveBeenCalledWith({ programId: "program-1", id: undefined, code: "9", name: "Objetivo nuevo" })
  })

  it("abre el formulario de edición con los valores existentes del objetivo", () => {
    const objectives = [makeObjective({ id: "objective-1", code: "1", name: "Objetivo uno" })]
    render(<ObjetivosTab programId="program-1" objectives={objectives} activities={[]} />)

    fireEvent.click(screen.getByRole("button", { name: "Editar" }))

    expect(screen.getByRole("dialog", { name: "Editar objetivo 1" })).toBeInTheDocument()
    expect(screen.getByLabelText(/Código/)).toHaveValue("1")
    expect(screen.getByLabelText(/Nombre/)).toHaveValue("Objetivo uno")
  })

  it("reordena con las flechas y llama a reorderPdtpObjectivesAction con el nuevo orden", async () => {
    const objectives = [
      makeObjective({ id: "objective-1", code: "1", name: "Objetivo uno", displayOrder: 0 }),
      makeObjective({ id: "objective-2", code: "2", name: "Objetivo dos", displayOrder: 1 }),
    ]
    render(<ObjetivosTab programId="program-1" objectives={objectives} activities={[]} />)

    fireEvent.click(screen.getAllByRole("button", { name: "Bajar" })[0]!)

    await vi.waitFor(() => expect(mockReorder).toHaveBeenCalledTimes(1))
    expect(mockReorder).toHaveBeenCalledWith({ programId: "program-1", orderedIds: ["objective-2", "objective-1"] })
  })
})

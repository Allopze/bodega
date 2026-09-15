// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { GuidedActivityForm } from "./guided-activity-form"

const { mockAdd, mockRefresh } = vi.hoisted(() => ({ mockAdd: vi.fn(), mockRefresh: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }))
vi.mock("../../actions", () => ({ addPdtpActivityAction: mockAdd }))

const RESPONSIBLES = [{ slug: "prevencionista", displayName: "Equipo de Prevención" }]
const CATALOG = [{
  id: "catalog-test",
  code: "PDT-TEST-ACTIVITY",
  title: "Verificar controles preventivos",
  description: "Verificar controles antes de iniciar la tarea",
  executionGuidance: "Registrar controles y conservar evidencia",
  status: "active" as const,
  currentRevision: 1,
}]

beforeEach(() => {
  window.localStorage.clear()
  mockAdd.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("GuidedActivityForm", () => {
  it("starts from prevention intent and previews a recurrence instead of a 48-cell editor", async () => {
    render(<GuidedActivityForm programId="program-2027" responsibleCatalog={RESPONSIBLES} catalogActivities={CATALOG} />)

    expect(screen.getByText("Con frecuencia")).toBeDefined()
    expect(screen.getByText("Cuando se necesite")).toBeDefined()
    expect(screen.getByText("Cuando ocurra un evento")).toBeDefined()
    expect(screen.getByText(/Genera 12 obligación\(es\)/)).toBeDefined()
    expect(screen.queryByText("Ene")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Seleccionar actividad" }))
    fireEvent.click(screen.getByRole("option", { name: /Verificar controles preventivos/ }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar actividad" }))

    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      programId: "program-2027",
      catalogActivityId: "catalog-test",
      scheduleMode: "scheduled",
      recurrenceRule: expect.objectContaining({ frequency: "monthly", plannedQuantity: 1 }),
      sheetCodes: ["pdtp_general"],
    })))
    expect(mockRefresh).toHaveBeenCalled()
  })

  it("models event-triggered work with a deadline and no fabricated weekly quota", async () => {
    render(<GuidedActivityForm programId="program-2028" responsibleCatalog={RESPONSIBLES} catalogActivities={CATALOG} />)

    fireEvent.click(screen.getByText("Cuando ocurra un evento"))
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar actividad" }))
    fireEvent.click(screen.getByRole("option", { name: /Verificar controles preventivos/ }))
    fireEvent.change(screen.getByLabelText(/Evento que genera la obligación/), { target: { value: "Ingreso de un trabajador nuevo" } })
    fireEvent.change(screen.getByLabelText("Plazo en días"), { target: { value: "2" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar actividad" }))

    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      scheduleMode: "triggered",
      recurrenceRule: null,
      triggerDescription: "Ingreso de un trabajador nuevo",
      dueDays: 2,
      indicatorMode: "closed_on_time",
    })))
  })
})

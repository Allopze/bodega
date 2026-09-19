// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { GuidedActivityForm } from "./guided-activity-form"

const { mockSave, mockRefresh } = vi.hoisted(() => ({ mockSave: vi.fn(), mockRefresh: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }))
vi.mock("@/app/(app)/prevencion/pdtp/actions", () => ({ savePdtpProgramActivityAction: mockSave }))

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
  mockSave.mockResolvedValue({ ok: true })
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
    expect(screen.getByText(/Genera 12 obligaciones/)).toBeDefined()
    expect(screen.queryByText("Ene")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Seleccionar actividad" }))
    fireEvent.click(screen.getByRole("option", { name: /Verificar controles preventivos/ }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar actividad" }))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
      programId: "program-2027",
      source: { kind: "catalog", catalogActivityId: "catalog-test" },
      scheduleMode: "scheduled",
      recurrenceRule: expect.objectContaining({ frequency: "monthly", plannedQuantity: 1 }),
      scheduleDefinition: expect.objectContaining({ kind: "recurring", unit: "month" }),
      executionConfig: expect.objectContaining({ destinationConnectorKey: "inspections" }),
      sheetCode: "pdtp_general",
    })))
    expect(mockRefresh).toHaveBeenCalled()
  })

  it("models event-triggered work with a deadline and no fabricated weekly quota", async () => {
    render(<GuidedActivityForm programId="program-2028" responsibleCatalog={RESPONSIBLES} catalogActivities={CATALOG} />)

    fireEvent.click(screen.getByText("Cuando ocurra un evento"))
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar actividad" }))
    fireEvent.click(screen.getByRole("option", { name: /Verificar controles preventivos/ }))
    fireEvent.change(screen.getByLabelText(/Evento que genera la obligación/), { target: { value: "Ingreso de un trabajador nuevo" } })
    fireEvent.change(screen.getByLabelText("Plazo"), { target: { value: "2" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar actividad" }))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
      scheduleMode: "triggered",
      recurrenceRule: null,
      triggerDescription: "Ingreso de un trabajador nuevo",
      scheduleDefinition: expect.objectContaining({ kind: "event", triggerConnectorKey: "worker" }),
    })))
  })

  it("permite expresar el plazo de un evento en horas", async () => {
    render(<GuidedActivityForm programId="program-2028" responsibleCatalog={RESPONSIBLES} catalogActivities={CATALOG} />)

    fireEvent.click(screen.getByText("Cuando ocurra un evento"))
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar actividad" }))
    fireEvent.click(screen.getByRole("option", { name: /Verificar controles preventivos/ }))
    fireEvent.change(screen.getByLabelText(/Evento que genera la obligación/), { target: { value: "Ingreso de un trabajador nuevo" } })
    fireEvent.click(document.getElementById("guided-due-unit")!)
    fireEvent.click(screen.getByRole("option", { name: "horas" }))
    fireEvent.change(screen.getByLabelText("Plazo"), { target: { value: "24" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar actividad" }))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
      scheduleDefinition: expect.objectContaining({ kind: "event", dueValue: 24, dueUnit: "hour" }),
    })))
  })

  it("preselecciona la actividad cuando Administración abre el creador anual", () => {
    render(
      <GuidedActivityForm
        programId="program-2027"
        responsibleCatalog={RESPONSIBLES}
        catalogActivities={CATALOG}
        initialCatalogActivityId="catalog-test"
      />,
    )

    expect(screen.getByRole("button", { name: /^Verificar controles preventivos$/ })).toBeDefined()
    expect(screen.getByText("Verificar controles antes de iniciar la tarea")).toBeDefined()
  })

  it("permite configurar más de un recordatorio y conserva sus offsets", async () => {
    render(<GuidedActivityForm programId="program-2027" responsibleCatalog={RESPONSIBLES} catalogActivities={CATALOG} />)

    fireEvent.click(screen.getByRole("button", { name: "Seleccionar actividad" }))
    fireEvent.click(screen.getByRole("option", { name: /Verificar controles preventivos/ }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar recordatorio" }))
    fireEvent.change(screen.getByLabelText("Desfase del recordatorio 2"), { target: { value: "0" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar actividad" }))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
      reminderRules: [
        { offsetValue: -5, offsetUnit: "day" },
        { offsetValue: 0, offsetUnit: "day" },
      ],
    })))
  })
})

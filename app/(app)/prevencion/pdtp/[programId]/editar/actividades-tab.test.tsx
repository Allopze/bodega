// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { pdtpActivities, pdtpActivitySchedule } from "@/db/schema"
import { ActividadesTab } from "./builder-tabs"

const { mockUpdate, mockBatchUpdate, mockSetObjective, mockRefresh } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockBatchUpdate: vi.fn(),
  mockSetObjective: vi.fn(),
  mockRefresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }) }))
vi.mock("../../actions", () => ({
  updatePdtpActivityAction: mockUpdate,
  duplicatePdtpActivityAction: vi.fn(),
  batchUpdatePdtpActivitiesAction: mockBatchUpdate,
  setPdtpActivityObjectiveAction: mockSetObjective,
  deletePdtpActivityAction: vi.fn(),
  reorderPdtpActivitiesAction: vi.fn(),
  adoptLatestCatalogRevisionAction: vi.fn(),
}))

const MONTHLY = { frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 2 }

function makeActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: "act-1",
    n: 1,
    activity: "Inspección de EPP",
    program: "Recorrido por faena",
    status: "active",
    scheduleMode: "scheduled",
    scheduleClassificationStatus: "confirmed",
    recurrenceRule: MONTHLY,
    triggerDescription: null,
    dueDays: null,
    notes: null,
    ...overrides,
  } as unknown as typeof pdtpActivities.$inferSelect
}

function makeCells(cells: Array<[number, number, number]>) {
  return cells.map(([month, week, plannedQuantity]) => ({
    activityId: "act-1", month, week, plannedQuantity,
  })) as unknown as Array<typeof pdtpActivitySchedule.$inferSelect>
}

function renderTab(props: Partial<Parameters<typeof ActividadesTab>[0]> = {}) {
  return render(
    <ActividadesTab
      programId="program-1"
      programYear={2027}
      periodStart={null}
      periodEnd={null}
      activities={[makeActivity()]}
      schedule={makeCells([])}
      responsibleCatalog={[]}
      catalogActivities={[]}
      {...props}
    />,
  )
}

beforeEach(() => {
  mockUpdate.mockResolvedValue({ ok: true })
  mockBatchUpdate.mockResolvedValue({ ok: true })
  mockSetObjective.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("EditActivityDialog", () => {
  it("cuenta el impacto sobre el horizonte real del programa, no sobre 12 meses", () => {
    renderTab({ periodStart: "2027-04-01", periodEnd: "2027-09-30" })
    fireEvent.click(screen.getByRole("button", { name: "Editar" }))

    // Un programa de 6 meses genera 6 obligaciones con una regla mensual.
    expect(screen.getByText(/6 obligaciones calendarizadas/)).toBeInTheDocument()
    expect(screen.queryByText(/12 obligaciones/)).not.toBeInTheDocument()
  })

  it("editar el texto de una actividad con matriz manual no exige confirmar nada", () => {
    renderTab({ schedule: makeCells([[1, 1, 3], [7, 4, 2]]) })
    fireEvent.click(screen.getByRole("button", { name: "Editar" }))

    fireEvent.change(screen.getByLabelText("Actividad preventiva"), { target: { value: "Texto corregido" } })
    expect(screen.queryByLabelText(/se reemplazará la planificación/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled()
  })

  it("permite declarar la evidencia mínima al editar una actividad histórica", async () => {
    renderTab({ activities: [makeActivity({ evidenceRequirement: null })] })
    fireEvent.click(screen.getByRole("button", { name: "Editar" }))

    fireEvent.change(screen.getByLabelText("Evidencia mínima esperada"), { target: { value: "Acta firmada y fotografía" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    await vi.waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      activityId: "act-1",
      evidenceRequirement: "Acta firmada y fotografía",
    })))
  })

  it("cambiar la frecuencia sobre una matriz manual exige confirmar y lo manda en el payload", async () => {
    renderTab({ schedule: makeCells([[1, 1, 3], [7, 4, 2]]) })
    fireEvent.click(screen.getByRole("button", { name: "Editar" }))

    fireEvent.change(screen.getByLabelText("Semana"), { target: { value: "3" } })

    const acknowledgement = screen.getByLabelText(/se reemplazará la planificación/)
    expect(screen.getByText(/2 semanas planificadas que no vienen de esta frecuencia/)).toBeInTheDocument()
    expect(screen.getByText(/cantidad planificada\s+pasa de 5 a 12/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled()

    fireEvent.click(acknowledgement)
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    await vi.waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate.mock.calls[0]![0]).toMatchObject({
      activityId: "act-1",
      scheduleReplaceConfirmed: true,
      recurrenceRule: { frequency: "monthly", weekOfMonth: 3 },
    })
  })

  it("conserva los meses de una recurrencia por meses seleccionados", async () => {
    const rule = { frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 1, months: [3, 8] }
    renderTab({ activities: [makeActivity({ recurrenceRule: rule })] })
    fireEvent.click(screen.getByRole("button", { name: "Editar" }))

    // Los meses guardados se muestran marcados y sobreviven al guardado: antes
    // se descartaban y Zod rechazaba el payload, dejando la actividad ineditable.
    expect(screen.getByLabelText("Mar")).toBeChecked()
    expect(screen.getByLabelText("Ago")).toBeChecked()
    expect(screen.getByLabelText("Ene")).not.toBeChecked()

    fireEvent.click(screen.getByLabelText("Ene"))
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    await vi.waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate.mock.calls[0]![0].recurrenceRule).toMatchObject({ frequency: "custom", months: [1, 3, 8] })
  })
})

describe("BatchEditActivitiesDialog", () => {
  const OBJECTIVES = [{ id: "objective-1", code: "1", name: "Objetivo Uno" }] as unknown as Parameters<typeof ActividadesTab>[0]["objectives"]

  it("envía el cambio de objetivo en el mismo POST atómico de batchUpdatePdtpActivitiesAction, no en llamadas sueltas por actividad", async () => {
    renderTab({
      activities: [makeActivity({ id: "act-1", n: 1 }), makeActivity({ id: "act-2", n: 2 })],
      objectives: OBJECTIVES,
    })

    fireEvent.click(screen.getByLabelText("Seleccionar actividad 1"))
    fireEvent.click(screen.getByLabelText("Seleccionar actividad 2"))
    fireEvent.click(screen.getByRole("button", { name: "Editar selección" }))

    fireEvent.click(screen.getByRole("combobox", { name: "Cambiar objetivo" }))
    fireEvent.click(screen.getByRole("option", { name: "1 · Objetivo Uno" }))
    fireEvent.click(screen.getByRole("button", { name: "Aplicar cambios" }))

    await vi.waitFor(() => expect(mockBatchUpdate).toHaveBeenCalledTimes(1))
    expect(mockBatchUpdate).toHaveBeenCalledWith(expect.objectContaining({
      activityIds: ["act-1", "act-2"],
      objectiveId: "objective-1",
    }))
    // Regresión: antes esto disparaba un `setPdtpActivityObjectiveAction` por
    // actividad seleccionada, sin atomicidad.
    expect(mockSetObjective).not.toHaveBeenCalled()
  })
})

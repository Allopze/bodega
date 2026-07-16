// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PdtpSheetTable } from "./pdtp-sheet-table"
import type { PdtpSheetView } from "@/lib/services/prevention-pdtp"
import type { PdtpPeriod } from "@/lib/services/pdtp/period"

vi.mock("./actions", () => ({
  markPdtpExecutionFormAction: vi.fn(),
  approvePdtpExecutionAction: vi.fn(),
}))

afterEach(() => cleanup())

const CURRENT_PERIOD: PdtpPeriod = { year: 2026, month: 7, week: 2 }

function makeActivity(
  id: string,
  n: string,
  activity: string,
  monthlyPlanned: number[],
  monthlyExecuted: number[],
  executions: PdtpSheetView["activities"][number]["executions"] = [],
  notes: string | null = null,
): PdtpSheetView["activities"][number] {
  const totalPlanned = monthlyPlanned.reduce((s, v) => s + v, 0)
  const totalExecuted = monthlyExecuted.reduce((s, v) => s + v, 0)
  return {
    id,
    n,
    activity,
    objective: `Objetivo ${n}`,
    program: "Programa X",
    responsibleDisplay: "Responsable X",
    schedule: monthlyPlanned.flatMap((plannedQuantity, index) => plannedQuantity > 0
      ? [{ month: index + 1, week: 2, plannedQuantity }]
      : []),
    monthlyPlanned,
    monthlyExecuted,
    totalPlanned,
    totalExecuted,
    executions,
    notes,
  } as unknown as PdtpSheetView["activities"][number]
}

const ZERO12 = Array.from({ length: 12 }, () => 0)

function withPlanned(month: number, value: number) {
  const arr = [...ZERO12]
  arr[month - 1] = value
  return arr
}

function makeView(activities: PdtpSheetView["activities"]): PdtpSheetView {
  return {
    program: {} as PdtpSheetView["program"],
    sheet: {} as PdtpSheetView["sheet"],
    activities,
    monthlyTotals: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      planned: 0,
      executed: 0,
      percent: null,
    })),
  }
}

describe("PdtpSheetTable — weekly filter", () => {
  const executedActivity = makeActivity("act-executed", "1", "Actividad ejecutada", withPlanned(7, 1), withPlanned(7, 1))
  const pendingActivity = makeActivity("act-pending", "2", "Actividad pendiente", withPlanned(7, 1), ZERO12)
  const overdueActivity = makeActivity(
    "act-overdue",
    "3",
    "Actividad atrasada",
    [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    ZERO12,
  )
  const notScheduledActivity = makeActivity("act-not-scheduled", "4", "Actividad sin plan este mes", ZERO12, ZERO12)

  it("includes only activities planned for the current week and shows their status chip", () => {
    const view = makeView([executedActivity, pendingActivity, overdueActivity, notScheduledActivity])
    render(<PdtpSheetTable view={view} viewMode="semana" currentPeriod={CURRENT_PERIOD} sheetCode="pdtp_general" />)

    expect(screen.getByText("Actividad ejecutada")).toBeDefined()
    expect(screen.getByText("Actividad pendiente")).toBeDefined()
    expect(screen.getByText("Actividad atrasada")).toBeDefined()
    expect(screen.queryByText("Actividad sin plan este mes")).toBeNull()

    const executedRow = screen.getByText("Actividad ejecutada").closest("tr")!
    const pendingRow = screen.getByText("Actividad pendiente").closest("tr")!
    const overdueRow = screen.getByText("Actividad atrasada").closest("tr")!
    expect(within(executedRow).getByText("Ejecutado")).toBeDefined()
    expect(within(pendingRow).getByText("Pendiente")).toBeDefined()
    // Badge now shows "Atrasado · N meses" when there are overdue months
    expect(within(overdueRow).getByText(/Atrasado/)).toBeDefined()
  })

  it("renders a friendly empty state when nothing is planned for the current week", () => {
    const view = makeView([notScheduledActivity])
    render(<PdtpSheetTable view={view} viewMode="semana" currentPeriod={CURRENT_PERIOD} sheetCode="pdtp_general" />)

    expect(screen.getByText("No hay actividades planificadas para esta semana.")).toBeDefined()
    expect(screen.queryByText("Actividad sin plan este mes")).toBeNull()
  })

  it("excludes activities planned later in the same month", () => {
    const thisWeek = makeActivity("act-this-week", "5", "Actividad de esta semana", withPlanned(7, 1), ZERO12)
    const laterWeek = makeActivity("act-later-week", "6", "Actividad de otra semana", withPlanned(7, 1), ZERO12)
    laterWeek.schedule = [{ month: 7, week: 3, plannedQuantity: 1 }] as never
    const view = makeView([thisWeek, laterWeek])

    render(<PdtpSheetTable view={view} viewMode="semana" currentPeriod={CURRENT_PERIOD} sheetCode="pdtp_general" />)

    expect(screen.getByText("Actividad de esta semana")).toBeDefined()
    expect(screen.queryByText("Actividad de otra semana")).toBeNull()
  })

  it("shows the 'Registrar' trigger button when canExecute and worksiteId are provided", () => {
    const view = makeView([pendingActivity])
    render(
      <PdtpSheetTable
        view={view}
        viewMode="semana"
        currentPeriod={CURRENT_PERIOD}
        sheetCode="pdtp_general"
        canExecute
        worksiteId="ws-1"
      />,
    )

    // The execution form is now a Dialog; the trigger button should be visible per activity.
    // Form internals (month/week defaults) are tested at the PdtpExecutionForm component level.
    const registerBtns = screen.getAllByText("Registrar")
    expect(registerBtns.length).toBeGreaterThan(0)
  })

  it("annual mode shows every activity, including ones with nothing planned this month", () => {
    const view = makeView([executedActivity, notScheduledActivity])
    render(<PdtpSheetTable view={view} viewMode="anual" currentPeriod={CURRENT_PERIOD} sheetCode="pdtp_general" />)

    expect(screen.getByText("Actividad ejecutada")).toBeDefined()
    expect(screen.getByText("Actividad sin plan este mes")).toBeDefined()
    // "—" appears multiple times (KPI cards, progress ring, etc.); just check it's present
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
  })

  it("muestra la nota de la actividad (H-M7)", () => {
    const withNotes = makeActivity("a-note", "5", "Actividad con nota", withPlanned(7, 1), ZERO12, [], "Esta es una nota de prueba sobre la actividad")
    const view = makeView([withNotes])
    // Modo semana filtra por monthlyPlanned[month-1] > 0. Nuestra actividad tiene plan en julio (month 7).
    const { container } = render(<PdtpSheetTable view={view} viewMode="semana" currentPeriod={CURRENT_PERIOD} sheetCode="pdtp_general" />)
    // Buscamos el <p> con title que contiene la nota
    const noteEl = container.querySelector(`p[title="Esta es una nota de prueba sobre la actividad"]`)
    expect(noteEl).toBeTruthy()
    expect(noteEl?.textContent).toContain("Esta es una nota de prueba")
  })
})

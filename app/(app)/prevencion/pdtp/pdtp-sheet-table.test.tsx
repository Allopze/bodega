// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PdtpSheetTable } from "./pdtp-sheet-table"
import { PdtpExecutionForm } from "./pdtp-execution-form"
import type { PdtpSheetView } from "@/lib/services/prevention-pdtp"
import type { PdtpPeriod } from "@/lib/services/pdtp/period"

vi.mock("./actions", () => ({
  markPdtpExecutionFormAction: vi.fn(),
  approvePdtpExecutionAction: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/prevencion/pdtp/actividades",
  useSearchParams: () => new URLSearchParams(),
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
  const schedule = monthlyPlanned.flatMap((plannedQuantity, index) => plannedQuantity > 0
    ? [{ month: index + 1, week: 2, plannedQuantity }]
    : [])
  return {
    id,
    n,
    activity,
    program: "Programa X",
    responsibleDisplay: "Responsable X",
    schedule,
    effectiveSchedule: schedule,
    monthlyPlanned,
    monthlyExecuted,
    effectiveMonthlyPlanned: monthlyPlanned,
    effectiveMonthlyExecuted: monthlyExecuted,
    totalPlanned,
    totalExecuted,
    effectiveTotalPlanned: totalPlanned,
    effectiveTotalExecuted: totalExecuted,
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

  it("applies a status filter received from the viewer URL", () => {
    const view = makeView([executedActivity, pendingActivity, overdueActivity])
    render(<PdtpSheetTable view={view} viewMode="semana" currentPeriod={CURRENT_PERIOD} sheetCode="pdtp_general" initialStatusFilter="pending" />)

    expect(screen.getByText("Actividad pendiente")).toBeDefined()
    expect(screen.queryByText("Actividad ejecutada")).toBeNull()
    expect(screen.queryByText("Actividad atrasada")).toBeNull()
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
    laterWeek.effectiveSchedule = laterWeek.schedule
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
    expect(screen.getByText("No programada en este período")).toBeDefined()
  })

  it("preserves the signed annual plan but does not mark pre-activation months overdue", () => {
    const activity = makeActivity(
      "act-midyear",
      "7",
      "Actividad aceptada en julio",
      [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      ZERO12,
    )
    activity.effectiveSchedule = [{ month: 7, week: 2, plannedQuantity: 1 }] as never
    activity.effectiveMonthlyPlanned = withPlanned(7, 1)
    activity.effectiveTotalPlanned = 1

    render(<PdtpSheetTable
      view={makeView([activity])}
      viewMode="anual"
      currentPeriod={CURRENT_PERIOD}
      sheetCode="pdtp_general"
    />)

    const row = screen.getByText("Actividad aceptada en julio").closest("tr")!
    expect(within(row).getByText("Pendiente")).toBeInTheDocument()
    expect(within(row).queryByText(/Atrasado/)).not.toBeInTheDocument()
    expect(row.lastElementChild).toHaveTextContent("2")
  })

  it("uses user-facing period and status labels in the annual execution details", () => {
    const execution = {
      id: "exec-1",
      year: 2026,
      month: 7,
      week: 2,
      executedQuantity: 1,
      status: "submitted",
      noCumpleCount: 0,
      actionsPending: 0,
      actionsOverdue: 0,
      evidenceUrl: null,
      evidencePhotos: [],
      evidenceText: null,
    } as PdtpSheetView["activities"][number]["executions"][number]
    const activity = makeActivity("annual-execution", "5", "Actividad anual", withPlanned(7, 1), withPlanned(7, 1), [execution])

    render(<PdtpSheetTable view={makeView([activity])} viewMode="anual" currentPeriod={CURRENT_PERIOD} sheetCode="pdtp_general" worksiteId="ws-1" />)

    expect(screen.getByText("Jul · Sem 2")).toBeDefined()
    expect(screen.getByText("Enviada")).toBeDefined()
    expect(screen.queryByText("M7/S2")).toBeNull()
    expect(screen.queryByText("submitted")).toBeNull()
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

describe("PdtpExecutionForm — vigencia", () => {
  it("no ofrece períodos anteriores y parte en la semana de aceptación", () => {
    render(<PdtpExecutionForm
      activityId="act-midyear"
      worksiteId="ws-1"
      year={2026}
      defaultMonth={7}
      defaultWeek={2}
      effectiveFrom={{ year: 2026, month: 7, week: 3 }}
    />)

    fireEvent.click(screen.getByRole("button", { name: "Registrar" }))
    expect(screen.getByRole("combobox", { name: "Semana" })).toHaveTextContent("3")

    fireEvent.click(screen.getByRole("combobox", { name: "Mes" }))
    expect(screen.queryByRole("option", { name: "Jun" })).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Jul" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Dic" })).toBeInTheDocument()
  })
})

describe("PdtpSheetTable — paginación de la vista anual", () => {
  const ANNUAL_PLAN = withPlanned(7, 1)

  function makeMany(count: number) {
    return Array.from({ length: count }, (_, i) =>
      makeActivity(`act-${i}`, String(i + 1), `Actividad número ${i + 1}`, ANNUAL_PLAN, ZERO12),
    ) as unknown as PdtpSheetView["activities"]
  }

  it("corta en 30 filas y expande al pulsar el botón", () => {
    const view = makeView(makeMany(35))
    render(<PdtpSheetTable view={view} viewMode="anual" currentPeriod={CURRENT_PERIOD} sheetCode="pdtp_general" />)

    expect(screen.getByText("Actividad número 30")).toBeDefined()
    expect(screen.queryByText("Actividad número 31")).toBeNull()

    const button = screen.getByRole("button", { name: /Mostrar las 35 actividades/ })
    fireEvent.click(button)

    // Regresión: la agrupación estaba memoizada con `filteredActivities` como
    // dependencia, así que al expandir el botón desaparecía pero la tabla seguía
    // mostrando 30 filas, sin forma de reintentar.
    expect(screen.getByText("Actividad número 31")).toBeDefined()
    expect(screen.getByText("Actividad número 35")).toBeDefined()
    expect(screen.queryByRole("button", { name: /Mostrar las 35 actividades/ })).toBeNull()
  })

  it("no pagina cuando el total no supera el límite", () => {
    const view = makeView(makeMany(30))
    render(<PdtpSheetTable view={view} viewMode="anual" currentPeriod={CURRENT_PERIOD} sheetCode="pdtp_general" />)

    expect(screen.getByText("Actividad número 30")).toBeDefined()
    expect(screen.queryByRole("button", { name: /Mostrar las/ })).toBeNull()
  })

  it("el contador del botón habla de las filas filtradas, no del total sin filtrar", () => {
    // 40 actividades: 35 pendientes en julio + 5 ejecutadas. Al filtrar por
    // "Ejecutadas" quedan 5 filas, así que no debe ofrecerse paginación —antes
    // `needsPagination` miraba el total sin filtrar y el botón prometía 40.
    const pending = Array.from({ length: 35 }, (_, i) =>
      makeActivity(`p-${i}`, String(i + 1), `Pendiente ${i + 1}`, ANNUAL_PLAN, ZERO12),
    )
    const executed = Array.from({ length: 5 }, (_, i) =>
      makeActivity(`e-${i}`, String(100 + i), `Ejecutada ${i + 1}`, ANNUAL_PLAN, withPlanned(7, 1)),
    )
    const view = makeView([...pending, ...executed] as unknown as PdtpSheetView["activities"])
    render(<PdtpSheetTable view={view} viewMode="anual" currentPeriod={CURRENT_PERIOD} sheetCode="pdtp_general" />)

    expect(screen.getByRole("button", { name: /Mostrar las 40 actividades/ })).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: /Ejecutadas/ }))

    expect(screen.queryByRole("button", { name: /Mostrar las/ })).toBeNull()
    expect(screen.getByText("Ejecutada 1")).toBeDefined()
  })
})

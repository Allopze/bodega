// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { pdtpActivities, pdtpActivitySchedule } from "@/db/schema"
import { PlanificacionTab } from "./builder-tabs"
import { ScheduleOverview } from "./tabs/planificacion-tab"
import { deriveScheduleHorizon } from "@/lib/services/pdtp/recurrence"

const { mockUpdate, mockRefresh } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockRefresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }) }))
vi.mock("../../actions", () => ({ updatePdtpActivityAction: mockUpdate }))

const ACTIVITIES = [
  { id: "act-1", n: 1, activity: "Inspección de EPP" },
] as unknown as Array<typeof pdtpActivities.$inferSelect>

const SCHEDULE = [
  { activityId: "act-1", month: 1, week: 1, plannedQuantity: 2 },
] as unknown as Array<typeof pdtpActivitySchedule.$inferSelect>

beforeEach(() => {
  vi.useFakeTimers()
  mockUpdate.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe("PlanificacionTab autosave", () => {
  it("autosaves a cell edit after a debounce pause, replacing the full-year schedule", async () => {
    render(<PlanificacionTab programId="program-1" year={2027} activities={ACTIVITIES} schedule={SCHEDULE} />)

    fireEvent.change(screen.getByTitle("Feb · Semana 1"), { target: { value: "3" } })
    // El estado dejó de ser un texto por fila: ahora es un badge en la fila más
    // una barra única al pie (antes había 40 botones y 40 etiquetas en pantalla).
    expect(screen.getByText("Sin guardar")).toBeInTheDocument()
    expect(screen.getByText("1 actividad con cambios sin guardar.")).toBeInTheDocument()
    expect(mockUpdate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1500)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const [call] = mockUpdate.mock.calls[0]!
    expect(call.activityId).toBe("act-1")
    expect(call.scheduleOverrides).toEqual(
      expect.arrayContaining([
        { month: 1, week: 1, plannedQuantity: 2 },
        { month: 2, week: 1, plannedQuantity: 3 },
      ]),
    )
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it("does not autosave before the debounce window elapses", () => {
    render(<PlanificacionTab programId="program-1" year={2027} activities={ACTIVITIES} schedule={SCHEDULE} />)

    fireEvent.change(screen.getByTitle("Mar · Semana 2"), { target: { value: "1" } })
    vi.advanceTimersByTime(1000)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("does not trigger a save when re-entering the same planned quantity", () => {
    render(<PlanificacionTab programId="program-1" year={2027} activities={ACTIVITIES} schedule={SCHEDULE} />)

    fireEvent.change(screen.getByTitle("Ene · Semana 1"), { target: { value: "2" } })
    expect(screen.queryByText("Sin guardar")).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Estado de la planificación" })).not.toBeInTheDocument()
  })
})

/** Radix DropdownMenu no responde a un `click` sintético en jsdom: abre con
 *  teclado o con pointerdown. */
function openRowMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /Atajos de planificación/ }), { key: "Enter" })
}

describe("PlanificacionTab: atajos, totales y validación", () => {
  it("el preset 1 × mes llena una semana por mes del período", () => {
    render(<PlanificacionTab programId="program-1" year={2027} activities={ACTIVITIES} schedule={SCHEDULE} />)

    openRowMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "1 × mes" }))

    for (const month of ["Ene", "Feb", "Dic"]) {
      expect(screen.getByTitle(`${month} · Semana 1`)).toHaveValue("1")
      expect(screen.getByTitle(`${month} · Semana 2`)).toHaveValue("")
    }
    // 12 meses × 1 semana: el total de la fila y el del pie coinciden.
    expect(screen.getAllByText("12").length).toBeGreaterThanOrEqual(2)
  })

  it("limpiar la fila exige confirmación y no borra nada si se cancela", () => {
    render(<PlanificacionTab programId="program-1" year={2027} activities={ACTIVITIES} schedule={SCHEDULE} />)
    expect(screen.getByTitle("Ene · Semana 1")).toHaveValue("2")

    openRowMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Limpiar fila" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(screen.getByTitle("Ene · Semana 1")).toHaveValue("2")

    openRowMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Limpiar fila" }))
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }))
    expect(screen.getByTitle("Ene · Semana 1")).toHaveValue("")
  })

  it("marca lo que no es una cantidad en vez de convertirlo en cero", () => {
    render(<PlanificacionTab programId="program-1" year={2027} activities={ACTIVITIES} schedule={SCHEDULE} />)

    const cell = screen.getByTitle("Ene · Semana 1")
    fireEvent.change(cell, { target: { value: "1x" } })

    // Antes cualquier texto se coercía a 0, borrando la celda en silencio.
    expect(cell).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("Revisa las cantidades")).toBeInTheDocument()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("Enter avanza a la siguiente celda y ↑/↓ se mueven entre filas por la misma semana", () => {
    const twoActivities = [
      { id: "act-1", n: 1, activity: "Inspección de EPP" },
      { id: "act-2", n: 2, activity: "Charla de seguridad" },
    ] as unknown as Array<typeof pdtpActivities.$inferSelect>
    render(<PlanificacionTab programId="program-1" year={2027} activities={twoActivities} schedule={SCHEDULE} />)

    const cells = screen.getAllByTitle("Ene · Semana 1")
    cells[0]!.focus()
    fireEvent.keyDown(cells[0]!, { key: "ArrowDown" })
    expect(document.activeElement).toBe(cells[1]!)

    fireEvent.keyDown(cells[1]!, { key: "ArrowUp" })
    expect(document.activeElement).toBe(cells[0]!)

    // Enter avanza en orden de lectura: siguiente semana de la misma fila.
    fireEvent.keyDown(cells[0]!, { key: "Enter" })
    expect(document.activeElement).toBe(screen.getAllByTitle("Ene · Semana 2")[0]!)
  })

  it("ante un conflicto detiene el autoguardado, ofrece recargar y no pierde lo tecleado", async () => {
    mockUpdate.mockResolvedValue({
      ok: false,
      message: "La planificación de esta actividad cambió en otra sesión. Recarga antes de guardar.",
      data: { scheduleConflict: { reason: "schedule_changed_elsewhere" } },
    })
    render(<PlanificacionTab programId="program-1" year={2027} activities={ACTIVITIES} schedule={SCHEDULE} />)

    fireEvent.change(screen.getByTitle("Feb · Semana 1"), { target: { value: "3" } })
    // act: el guardado es asíncrono y su resultado cambia el estado de la fila;
    // sin envolverlo, el re-render no se ha aplicado al aseverarlo.
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(mockUpdate).toHaveBeenCalledTimes(1)

    expect(screen.getByText("Cambió en otra sesión")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Recargar" })).toBeInTheDocument()
    // Lo tecleado sigue ahí; guardar de nuevo pisaría a la otra sesión, así que
    // "Guardar todo" queda inhabilitado.
    expect(screen.getByTitle("Feb · Semana 1")).toHaveValue("3")
    expect(screen.getByRole("button", { name: "Guardar todo" })).toBeDisabled()

    // Y sobre todo: no reintenta en bucle contra una huella que no va a cambiar.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it("muestra el total de la fila y el total por mes", () => {
    render(<PlanificacionTab
      programId="program-1"
      year={2027}
      activities={ACTIVITIES}
      schedule={[
        { activityId: "act-1", month: 1, week: 1, plannedQuantity: 2 },
        { activityId: "act-1", month: 1, week: 3, plannedQuantity: 1 },
      ] as unknown as Array<typeof pdtpActivitySchedule.$inferSelect>}
    />)

    // 2 + 1 en enero: total de fila 3 y total de enero 3.
    expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(2)
  })
})

describe("ScheduleOverview", () => {
  const MONTHLY = { frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 2 }

  const activityWithRule = [{
    id: "act-1", n: 1, activity: "Inspección de EPP",
    scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
    recurrenceRule: MONTHLY, dueDays: null, triggerDescription: null,
  }] as unknown as Array<typeof pdtpActivities.$inferSelect>

  const cells = (list: Array<[number, number, number]>) => list.map(([month, week, plannedQuantity]) => ({
    activityId: "act-1", month, week, plannedQuantity,
  })) as unknown as Array<typeof pdtpActivitySchedule.$inferSelect>

  it("describe la recurrencia sobre el horizonte real del programa", () => {
    const horizon = deriveScheduleHorizon({ year: 2027, periodStart: "2027-04-01", periodEnd: "2027-09-30" })
    render(<ScheduleOverview activities={activityWithRule} schedule={cells([])} horizon={horizon} />)

    expect(screen.getByText(/Genera 6 obligación\(es\)/)).toBeInTheDocument()
  })

  it("marca la actividad cuya matriz se ajustó a mano y ya no coincide con su recurrencia", () => {
    render(<ScheduleOverview
      activities={activityWithRule}
      schedule={cells([[1, 1, 3], [7, 4, 2]])}
      horizon={deriveScheduleHorizon({ year: 2027 })}
    />)

    expect(screen.getByText("Matriz manual")).toBeInTheDocument()
    expect(screen.getByText(/ajustadas manualmente/)).toBeInTheDocument()
  })

  it("no marca nada cuando las celdas son exactamente la proyección de la regla", () => {
    const projected = Array.from({ length: 12 }, (_, index) => [index + 1, 2, 1] as [number, number, number])
    render(<ScheduleOverview
      activities={activityWithRule}
      schedule={cells(projected)}
      horizon={deriveScheduleHorizon({ year: 2027 })}
    />)

    expect(screen.queryByText("Matriz manual")).not.toBeInTheDocument()
  })
})

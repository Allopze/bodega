// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { pdtpActivities, pdtpActivitySchedule } from "@/db/schema"
import { PlanificacionTab } from "./builder-tabs"

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
    expect(screen.getAllByText("Cambios sin guardar").length).toBeGreaterThan(0)
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
    expect(screen.getAllByText("Guardado").length).toBeGreaterThan(0)
  })
})

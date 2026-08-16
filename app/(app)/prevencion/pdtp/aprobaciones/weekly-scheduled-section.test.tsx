// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { WeeklyScheduledSection } from "./weekly-scheduled-section"
import type { PdtpPendingTarget } from "@/lib/services/prevention-pdtp"

afterEach(cleanup)

const WEEKLY_PENDING: PdtpPendingTarget[] = [
  { worksiteId: "ws-1", worksiteName: "Faena A", activityIds: ["act-1", "act-2"] },
]

describe("WeeklyScheduledSection — actividades programadas de la semana", () => {
  it("lists each faena with its pending activity count", () => {
    render(<WeeklyScheduledSection targets={WEEKLY_PENDING} />)

    expect(screen.getByText("Programadas esta semana")).toBeInTheDocument()
    expect(screen.getByText("Faena A")).toBeInTheDocument()
    expect(screen.getByText("2 actividad(es) sin ejecutar esta semana")).toBeInTheDocument()
  })

  it("shows an empty state when nothing is scheduled without execution", () => {
    render(<WeeklyScheduledSection targets={[]} />)
    expect(screen.getByText("Sin pendientes calendarizados")).toBeInTheDocument()
  })
})

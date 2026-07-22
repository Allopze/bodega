// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { PendingApprovalSection, WeeklyScheduledSection } from "./pdtp-obligations-workbench"
import type { PdtpPendingTarget, PendingPdtpExecution } from "@/lib/services/prevention-pdtp"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

afterEach(cleanup)

const WEEKLY_PENDING: PdtpPendingTarget[] = [
  { worksiteId: "ws-1", worksiteName: "Faena A", activityIds: ["act-1", "act-2"] },
]

const PENDING_APPROVAL: PendingPdtpExecution[] = [
  {
    id: "exec-1", activityId: "act-3", activityN: 12, activityName: "Inspección de extintores",
    worksiteId: "ws-1", worksiteName: "Faena A", year: 2026, month: 3, week: 2,
    executedQuantity: 1, evidenceText: null, evidenceUrl: null, evidencePhotos: [],
    executedByUserId: "user-1", executedAt: "2026-03-10T10:00:00.000Z",
  },
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

describe("PendingApprovalSection — ejecuciones reportadas pendientes de aprobación", () => {
  it("lists submitted executions distinctly from on-demand obligations", () => {
    render(<PendingApprovalSection executions={PENDING_APPROVAL} canExecute />)

    expect(screen.getByText("Pendientes de evidencia o aprobación")).toBeInTheDocument()
    expect(screen.getByText(/Inspección de extintores/)).toBeInTheDocument()
    expect(screen.getByText(/Sin evidencia adjunta/)).toBeInTheDocument()
    expect(screen.getByText("Ir a aprobación")).toBeInTheDocument()
  })

  it("hides the approval link when the user cannot execute", () => {
    render(<PendingApprovalSection executions={PENDING_APPROVAL} canExecute={false} />)
    expect(screen.queryByText("Ir a aprobación")).not.toBeInTheDocument()
  })

  it("shows an empty state when nothing is pending approval", () => {
    render(<PendingApprovalSection executions={[]} canExecute />)
    expect(screen.getByText("Sin ejecuciones pendientes de aprobación")).toBeInTheDocument()
  })
})

// @vitest-environment jsdom
/**
 * En la pestaña de protocolos, la evaluación cuantitativa N°45 va como una lista por faena
 * (hecha / pendiente) y no como un calendario faena × mes: la actividad es una sola casilla
 * al año, así que el calendario tenía una celda exigible de doce por fila.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

const state = vi.hoisted(() => ({ tab: "protocols" as string | null }))

vi.mock("@/lib/hooks/use-url-filters", () => ({
  useUrlFilters: () => ({
    getFilter: (key: string) => (key === "tab" ? state.tab : null),
    setFilters: vi.fn(),
    setFilter: vi.fn(),
    clearFilters: vi.fn(),
  }),
}))
vi.mock("@/components/layout/header-context", () => ({ useSafeShellHeader: () => ({ searchQuery: "" }) }))
vi.mock("./protocols-panel", () => ({ ProtocolsPanel: () => <div data-testid="protocols-panel" /> }))
vi.mock("./hygiene-dialogs", () => ({ NewGroupDialog: () => null, NewProgramDialog: () => null }))

import { HygieneDashboard } from "./hygiene-dashboard"

afterEach(cleanup)

const baseProps = {
  groups: [],
  programs: [],
  summary: [],
  agents: [],
  worksites: [],
  protocolWorksites: [{ id: "ws-a", name: "Faena Alfa" }, { id: "ws-b", name: "Faena Beta" }],
  applicabilities: [],
  measurementSlots: [
    {
      id: "slot-a", version: 1, slotKey: "n45", worksiteId: "ws-a", scheduledMonth: 2, scheduledWeek: 2, status: "completed" as const,
      observation: null, notApplicableReason: null, fulfilledLabel: null, measuredOn: "2026-02-12", groupCode: "SIO2-A",
    },
    {
      id: "slot-b", version: 1, slotKey: "n45", worksiteId: "ws-b", scheduledMonth: 2, scheduledWeek: 2, status: "pending" as const,
      observation: null, notApplicableReason: null, fulfilledLabel: null, measuredOn: null, groupCode: null,
    },
  ],
  slotYear: 2026,
  activationPeriods: {},
  canRecordMeasurementSlots: true,
  today: "2026-11-03",
  canAssess: true,
}

describe("HygieneDashboard · evaluación cuantitativa N°45", () => {
  it("en protocolos muestra la lista por faena y ningún calendario", () => {
    const { container } = render(<HygieneDashboard {...baseProps} />)
    expect(screen.getByRole("list", { name: "Evaluación cuantitativa N°45 por faena" })).toBeDefined()
    expect(screen.getByText("1 de 2 faenas con la evaluación hecha")).toBeDefined()
    expect(container.querySelector("table")).toBeNull()
    expect(screen.getByTestId("protocols-panel")).toBeDefined()
  })

  it("fuera de la pestaña de protocolos no aparece", () => {
    state.tab = "groups"
    render(<HygieneDashboard {...baseProps} />)
    expect(screen.queryByRole("list", { name: "Evaluación cuantitativa N°45 por faena" })).toBeNull()
    state.tab = "protocols"
  })
})

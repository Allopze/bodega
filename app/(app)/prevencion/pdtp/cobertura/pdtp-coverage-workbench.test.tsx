// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PropsWithChildren } from "react"
import type { getPdtpCoverage } from "@/lib/services/prevention-risk-legal"

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a>,
}))
vi.mock("./actions", () => ({
  linkPdtpActivitySourceAction: vi.fn(),
  resolvePdtpUpdateObligationAction: vi.fn(),
}))

import { PdtpCoverageWorkbench } from "./pdtp-coverage-workbench"

type Coverage = Awaited<ReturnType<typeof getPdtpCoverage>>

afterEach(cleanup)

describe("PdtpCoverageWorkbench", () => {
  it("shows unsourced work as a blocker and links every supported source to its exact record", () => {
    const coverage = {
      program: { id: "program-1", year: 2026, version: 3 },
      coverage: { sourcedActivities: 1, totalActivities: 2, unsourcedActivities: 1, pendingUpdates: 0 },
      obligations: [],
      activities: [
        {
          id: "activity-1", n: "1", activity: "Verificar control crítico", objective: "Reducir exposición",
          sources: [
            { id: "link-risk", sourceType: "risk_control", sourceId: "control-1", sourceVersionSnapshot: "MIPER v2" },
            { id: "link-legal", sourceType: "legal_requirement", sourceId: "requirement-1", sourceVersionSnapshot: "DS44 v1" },
            { id: "link-capa", sourceType: "incident_capa", sourceId: "capa-1", sourceVersionSnapshot: "CAPA v4" },
          ],
        },
        { id: "activity-2", n: "2", activity: "Actividad huérfana", objective: "Debe conciliarse", sources: [] },
      ],
    } as unknown as Coverage

    render(<PdtpCoverageWorkbench coverage={coverage} worksites={[]} canManage={false} />)

    expect(screen.getByRole("status")).toHaveTextContent("actividades sin fuente demostrable")
    expect(screen.getByText("Sin fuente")).toBeDefined()
    expect(screen.getByRole("link", { name: /Control MIPER · MIPER v2/ })).toHaveAttribute("href", "/prevencion/miper/controles/control-1")
    expect(screen.getByRole("link", { name: /Requisito legal · DS44 v1/ })).toHaveAttribute("href", "/prevencion/requisitos-legales/requirement-1")
    expect(screen.getByRole("link", { name: /Incidente\/CAPA · CAPA v4/ })).toHaveAttribute("href", "/prevencion/capa/capa-1")
  })

  it("offers a populated CAPA picker scoped to the selected worksite when linking a new source", () => {
    const coverage = {
      program: { id: "program-1", year: 2026, version: 3 },
      coverage: { sourcedActivities: 0, totalActivities: 1, unsourcedActivities: 1, pendingUpdates: 0 },
      obligations: [],
      activities: [{ id: "activity-1", n: "1", activity: "Actividad", objective: "Objetivo", sources: [] }],
    } as unknown as Coverage
    const capaActions = [
      { id: "capa-1", worksiteId: "ws-1", label: "CAPA-001 · Hallazgo en faena 1" },
      { id: "capa-2", worksiteId: "ws-2", label: "CAPA-002 · Hallazgo en faena 2" },
    ]

    render(
      <PdtpCoverageWorkbench
        coverage={coverage}
        sourceOptions={{ incident_capa: capaActions }}
        worksites={[{ id: "ws-1", name: "Faena Uno" }, { id: "ws-2", name: "Faena Dos" }]}
        canManage
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Vincular fuente" }))
    fireEvent.click(screen.getByRole("combobox", { name: "Tipo" }))
    fireEvent.click(screen.getByRole("option", { name: "Incidente / CAPA" }))
    fireEvent.click(screen.getByRole("combobox", { name: "Fuente" }))

    expect(screen.getByRole("option", { name: "CAPA-001 · Hallazgo en faena 1" })).toBeDefined()
    expect(screen.queryByRole("option", { name: "CAPA-002 · Hallazgo en faena 2" })).toBeNull()
    expect(screen.queryByPlaceholderText("ID CAPA, auditoría, contrato u objetivo")).toBeNull()
  })

  it("offers a populated picker for the newer source domains (capacitación) scoped by faena", () => {
    const coverage = {
      program: { id: "program-1", year: 2026, version: 3 },
      coverage: { sourcedActivities: 0, totalActivities: 1, unsourcedActivities: 1, pendingUpdates: 0 },
      obligations: [],
      activities: [{ id: "activity-1", n: "1", activity: "Actividad", objective: "Objetivo", sources: [] }],
    } as unknown as Coverage
    const trainingSessions = [
      { id: "train-1", worksiteId: "ws-1", label: "SES-001 · Trabajo en altura" },
      { id: "train-2", worksiteId: "ws-2", label: "SES-002 · Espacios confinados" },
    ]

    render(
      <PdtpCoverageWorkbench
        coverage={coverage}
        sourceOptions={{ capacitacion: trainingSessions }}
        worksites={[{ id: "ws-1", name: "Faena Uno" }, { id: "ws-2", name: "Faena Dos" }]}
        canManage
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Vincular fuente" }))
    fireEvent.click(screen.getByRole("combobox", { name: "Tipo" }))
    fireEvent.click(screen.getByRole("option", { name: "Capacitación" }))
    fireEvent.click(screen.getByRole("combobox", { name: "Fuente" }))

    expect(screen.getByRole("option", { name: "SES-001 · Trabajo en altura" })).toBeDefined()
    expect(screen.queryByRole("option", { name: "SES-002 · Espacios confinados" })).toBeNull()
  })

  it("falls back to a free-text source id for types without a populated picker (auditoría)", () => {
    const coverage = {
      program: { id: "program-1", year: 2026, version: 3 },
      coverage: { sourcedActivities: 0, totalActivities: 1, unsourcedActivities: 1, pendingUpdates: 0 },
      obligations: [],
      activities: [{ id: "activity-1", n: "1", activity: "Actividad", objective: "Objetivo", sources: [] }],
    } as unknown as Coverage

    render(<PdtpCoverageWorkbench coverage={coverage} worksites={[{ id: "ws-1", name: "Faena Uno" }]} canManage />)

    fireEvent.click(screen.getByRole("button", { name: "Vincular fuente" }))
    fireEvent.click(screen.getByRole("combobox", { name: "Tipo" }))
    fireEvent.click(screen.getByRole("option", { name: "Auditoría" }))

    expect(screen.getByPlaceholderText("ID CAPA, auditoría, contrato u objetivo")).toBeDefined()
  })
})

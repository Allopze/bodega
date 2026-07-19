// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
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

    render(<PdtpCoverageWorkbench coverage={coverage} riskControls={[]} legalRequirements={[]} worksites={[]} canManage={false} />)

    expect(screen.getByRole("status")).toHaveTextContent("actividades sin fuente demostrable")
    expect(screen.getByText("Sin fuente")).toBeDefined()
    expect(screen.getByRole("link", { name: /Control MIPER · MIPER v2/ })).toHaveAttribute("href", "/prevencion/miper/controles/control-1")
    expect(screen.getByRole("link", { name: /Requisito legal · DS44 v1/ })).toHaveAttribute("href", "/prevencion/requisitos-legales/requirement-1")
    expect(screen.getByRole("link", { name: /Incidente\/CAPA · CAPA v4/ })).toHaveAttribute("href", "/prevencion/capa/capa-1")
  })
})

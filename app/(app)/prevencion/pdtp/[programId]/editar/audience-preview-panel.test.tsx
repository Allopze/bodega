// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { pdtpActivities } from "@/db/schema"
import { AudiencePreviewPanel } from "./builder-tabs"

type ActivityRow = typeof pdtpActivities.$inferSelect

function activity(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: overrides.id as string,
    n: overrides.n as number,
    responsibleSlugs: [],
    responsibleDisplay: "",
    audienceRoles: [],
    ...overrides,
  } as unknown as ActivityRow
}

const ACTIVITIES: ActivityRow[] = [
  activity({ id: "a1", n: 1, responsibleSlugs: ["prevencionista_faena"], responsibleDisplay: "PRF", audienceRoles: ["prf"] }),
  activity({ id: "a2", n: 2, responsibleSlugs: ["jefa_chome"], responsibleDisplay: "Subgerencia", audienceRoles: ["subgerente"] }),
  activity({ id: "a3", n: 3, responsibleSlugs: ["prevencionista_faena", "jefa_chome"], responsibleDisplay: "PRF y Subgerencia", audienceRoles: ["prf", "subgerente"] }),
]

const RESPONSIBLES = [
  { slug: "prevencionista_faena", displayName: "Prevencionista de faena" },
  { slug: "jefa_chome", displayName: "Jefatura Chome" },
]

afterEach(() => cleanup())

describe("AudiencePreviewPanel", () => {
  it("shows every activity when no filter is selected", () => {
    render(<AudiencePreviewPanel activities={ACTIVITIES} responsibleCatalog={RESPONSIBLES} appliesToAllWorksites />)
    expect(screen.getByText("3 de 3 actividades visibles para esta combinación.")).toBeDefined()
  })

  it("filters to the activities matching the selected responsable", () => {
    render(<AudiencePreviewPanel activities={ACTIVITIES} responsibleCatalog={RESPONSIBLES} appliesToAllWorksites />)
    fireEvent.click(screen.getByLabelText("Responsable"))
    fireEvent.click(screen.getByText("Jefatura Chome"))
    expect(screen.getByText("2 de 3 actividades visibles para esta combinación.")).toBeDefined()
    expect(screen.getByText(/N°2/)).toBeDefined()
    expect(screen.getByText(/N°3/)).toBeDefined()
  })

  it("filters to the activities matching the selected audiencia", () => {
    render(<AudiencePreviewPanel activities={ACTIVITIES} responsibleCatalog={RESPONSIBLES} appliesToAllWorksites />)
    fireEvent.click(screen.getByLabelText("Audiencia"))
    fireEvent.click(screen.getByText("subgerente"))
    expect(screen.getByText("2 de 3 actividades visibles para esta combinación.")).toBeDefined()
  })

  it("does not show a faena filter when no worksites are passed (backward compatible)", () => {
    render(<AudiencePreviewPanel activities={ACTIVITIES} responsibleCatalog={RESPONSIBLES} appliesToAllWorksites />)
    expect(screen.queryByLabelText("Faena")).toBeNull()
  })

  const WORKSITES = [{ id: "ws-1", name: "Faena Uno", code: "F1" }, { id: "ws-2", name: "Faena Dos", code: "F2" }]

  it("excludes an activity only for the faena it was excluded from", () => {
    render(
      <AudiencePreviewPanel
        activities={ACTIVITIES}
        responsibleCatalog={RESPONSIBLES}
        appliesToAllWorksites
        visibleWorksites={WORKSITES}
        exclusions={[{ activityId: "a1", worksiteId: "ws-1" }]}
      />,
    )
    fireEvent.click(screen.getByLabelText("Faena"))
    fireEvent.click(screen.getByText("Faena Uno"))
    expect(screen.getByText("2 de 3 actividades visibles para esta combinación.")).toBeDefined()
    expect(screen.queryByText(/N°1/)).toBeNull()
  })

  it("shows a warning and zero activities for a faena outside a declared membership", () => {
    render(
      <AudiencePreviewPanel
        activities={ACTIVITIES}
        responsibleCatalog={RESPONSIBLES}
        visibleWorksites={WORKSITES}
        memberWorksiteIds={["ws-2"]}
        appliesToAllWorksites={false}
      />,
    )
    fireEvent.click(screen.getByLabelText("Faena"))
    fireEvent.click(screen.getByText("Faena Uno"))
    expect(screen.getByText(/no está habilitada para este programa/)).toBeDefined()
  })

  it("does not treat an empty membership as corporate scope when it is undeclared", () => {
    render(
      <AudiencePreviewPanel
        activities={ACTIVITIES}
        responsibleCatalog={RESPONSIBLES}
        visibleWorksites={WORKSITES}
        appliesToAllWorksites={false}
      />,
    )
    fireEvent.click(screen.getByLabelText("Faena"))
    fireEvent.click(screen.getByText("Faena Uno"))
    expect(screen.getByText(/no está habilitada para este programa/)).toBeDefined()
  })
})

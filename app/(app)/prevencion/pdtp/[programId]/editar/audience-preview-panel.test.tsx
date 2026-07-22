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
    render(<AudiencePreviewPanel activities={ACTIVITIES} responsibleCatalog={RESPONSIBLES} />)
    expect(screen.getByText("3 de 3 actividad(es) visibles para esta combinación.")).toBeDefined()
  })

  it("filters to the activities matching the selected responsable", () => {
    render(<AudiencePreviewPanel activities={ACTIVITIES} responsibleCatalog={RESPONSIBLES} />)
    fireEvent.click(screen.getByLabelText("Responsable"))
    fireEvent.click(screen.getByText("Jefatura Chome"))
    expect(screen.getByText("2 de 3 actividad(es) visibles para esta combinación.")).toBeDefined()
    expect(screen.getByText(/N°2/)).toBeDefined()
    expect(screen.getByText(/N°3/)).toBeDefined()
  })

  it("filters to the activities matching the selected audiencia", () => {
    render(<AudiencePreviewPanel activities={ACTIVITIES} responsibleCatalog={RESPONSIBLES} />)
    fireEvent.click(screen.getByLabelText("Audiencia"))
    fireEvent.click(screen.getByText("subgerente"))
    expect(screen.getByText("2 de 3 actividad(es) visibles para esta combinación.")).toBeDefined()
  })
})

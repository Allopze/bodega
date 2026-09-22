// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { pdtpActivities, pdtpPrograms } from "@/db/schema"
import { ReviewTab } from "./revision-tab"
import type { PdtpActivityRow } from "./types"

function makeActivity(overrides: Partial<typeof pdtpActivities.$inferSelect> = {}): PdtpActivityRow {
  return {
    id: "activity-1",
    n: 7,
    activity: "Verificar controles preventivos",
    responsibleDisplay: "Equipo de Prevención",
    responsibleSlugs: ["prevencionista"],
    audienceRoles: [],
    status: "active",
    scheduleMode: "scheduled",
    scheduleClassificationStatus: "confirmed",
    recurrenceRule: { frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
    sourceSheetRow: 1,
    triggerDescription: null,
    evidenceRequirement: null,
    ...overrides,
  } as unknown as PdtpActivityRow
}

const PROGRAM = {
  id: "program-1",
  title: "Programa preventivo 2027",
  appliesToAllWorksites: true,
} as unknown as typeof pdtpPrograms.$inferSelect

afterEach(() => cleanup())

describe("ReviewTab", () => {
  it("offers a route to complete missing evidence declarations from review", () => {
    render(
      <ReviewTab
        program={PROGRAM}
        activities={[
          makeActivity(),
          makeActivity({ id: "activity-2", n: 8, evidenceRequirement: "Acta firmada" }),
        ]}
        responsibleCatalog={[]}
        visibleWorksites={[]}
        memberWorksiteIds={[]}
        appliesToAllWorksites
        activityWorksiteExclusions={[]}
        baseComparison={null}
        revisionDiffDecisions={[]}
      />,
    )

    expect(screen.getByText("Evidencia mínima")).toBeInTheDocument()
    expect(screen.getByText(/Aquí defines qué respaldo mínimo debe quedar/)).toBeInTheDocument()
    expect(screen.getByText(/El archivo, registro u observación se incorpora al registrar la ejecución/)).toBeInTheDocument()
    expect(screen.getByText("1 sin requisito de evidencia declarado")).toBeInTheDocument()
    expect(screen.getByText(/Faltan: N°7/)).toBeInTheDocument()
    const link = screen.getByRole("link", { name: "Definir evidencia en Actividades" })
    expect(link).toHaveAttribute("href", "/prevencion/pdtp/program-1/editar?seccion=actividades")
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PdtpActions } from "./pdtp-actions"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/(app)/prevencion/pdtp/actions", () => ({ savePdtpProgramActivityAction: vi.fn() }))
vi.mock("./actions", () => ({
  savePdtpCatalogActivityAction: vi.fn(),
  savePdtpResponsibleAction: vi.fn(),
  savePdtpSheetAction: vi.fn(),
}))

const PROGRAMS = [{ id: "program-1", year: 2028, version: 1, status: "draft", title: "Programa 2028" }]
const RESPONSIBLES = [{ slug: "prevencionista", displayName: "Equipo de Prevención" }]
const ACTIVITIES = [{
  id: "catalog-1",
  code: "PDT-TEST",
  title: "Actividad existente",
  description: "Descripción",
  executionGuidance: "Guía",
  status: "active" as const,
  currentRevision: 1,
}]

afterEach(() => cleanup())

describe("PdtpActions", () => {
  it("ofrece la creación operativa y conserva la plantilla como acción secundaria", () => {
    render(<PdtpActions programs={PROGRAMS} roleOptions={[]} responsibleCatalog={RESPONSIBLES} catalogActivities={ACTIVITIES} canManagePrograms />)

    expect(screen.getByRole("button", { name: /Nueva actividad/ })).toBeDefined()
    expect(screen.getByRole("button", { name: /Nueva plantilla/ })).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: /Nueva actividad/ }))
    expect(screen.getByRole("dialog", { name: "Nueva actividad" })).toBeDefined()
    expect(screen.getByLabelText("Programa anual")).toBeDefined()
  })

  it("oculta la creación operativa a quien no administra programas", () => {
    render(<PdtpActions programs={PROGRAMS} roleOptions={[]} responsibleCatalog={RESPONSIBLES} catalogActivities={ACTIVITIES} canManagePrograms={false} />)

    expect(screen.queryByRole("button", { name: /Nueva actividad/ })).toBeNull()
    expect(screen.getByRole("button", { name: /Nueva plantilla/ })).toBeDefined()
  })

  it("explica por qué no se puede crear cuando no hay programas editables", () => {
    render(<PdtpActions programs={[]} roleOptions={[]} responsibleCatalog={RESPONSIBLES} catalogActivities={ACTIVITIES} canManagePrograms />)

    expect(screen.getByRole("button", { name: /Nueva actividad/ })).toBeDisabled()
    expect(screen.getByText(/Crea o abre un programa en borrador/)).toBeDefined()
    expect(screen.getByRole("link", { name: "Ir a Programas PDTP" })).toHaveAttribute("href", "/prevencion/pdtp")
  })
})

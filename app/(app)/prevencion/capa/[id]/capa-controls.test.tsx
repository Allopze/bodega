// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("../actions", () => ({
  addCapaEvidenceAction: vi.fn(), addCapaFollowupAction: vi.fn(), reconcileCapaActionAction: vi.fn(),
  transitionCapaActionAction: vi.fn(), updateCapaActionAction: vi.fn(),
}))

import { CapaControls } from "./capa-controls"

const none = { manage: false, complete: false, verify: false, close: false, reconcile: false, overrideSegregation: false }
const all = { manage: true, complete: true, verify: true, close: true, reconcile: true, overrideSegregation: true }
const manualSource = { sourceType: "manual", sourceId: "libre-1" }

describe("CapaControls permission visibility", () => {
  it("hides implementation and closure controls without their permissions", () => {
    const { rerender } = render(<CapaControls action={{
      id: "c1", version: 1, status: "pending", priority: "medium", targetDate: "2026-08-01",
      responsibleUserId: null, reconciliationStatus: "reconciled", ...manualSource,
    }} users={[]} permissions={none} />)
    expect(screen.queryByText("Iniciar implementación")).not.toBeInTheDocument()

    rerender(<CapaControls action={{
      id: "c1", version: 2, status: "verified", priority: "medium", targetDate: "2026-08-01",
      responsibleUserId: null, reconciliationStatus: "reconciled", ...manualSource,
    }} users={[]} permissions={none} />)
    expect(screen.queryByText("Cerrar CAPA")).not.toBeInTheDocument()
  })

  it("shows closure only with the dedicated permission", () => {
    render(<CapaControls action={{
      id: "c1", version: 2, status: "verified", priority: "medium", targetDate: "2026-08-01",
      responsibleUserId: null, reconciliationStatus: "reconciled", ...manualSource,
    }} users={[]} permissions={{ ...none, close: true }} />)
    expect(screen.getByText("Cerrar CAPA")).toBeInTheDocument()
  })
})

/**
 * PPA-03: el avance de una acción nacida de un PPA lo conduce el PPA. El
 * servidor rechaza transición y edición para ese origen; la UI no debe ofrecer
 * botones que sólo pueden fallar.
 */
describe("CapaControls con origen ppa", () => {
  it("oculta transición, verificación y asignación, y enlaza al PPA de origen", () => {
    render(<CapaControls action={{
      id: "c1", version: 1, status: "pending_verification", priority: "medium", targetDate: "2026-08-01",
      responsibleUserId: null, reconciliationStatus: "reconciled",
      sourceType: "ppa", sourceId: "ppa-9",
    }} users={[]} permissions={all} />)

    expect(screen.queryByText("Iniciar implementación")).not.toBeInTheDocument()
    expect(screen.queryByText("Cancelar CAPA")).not.toBeInTheDocument()
    expect(screen.queryByText("Verificar eficacia")).not.toBeInTheDocument()
    expect(screen.queryByText("Asignación y plazo")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "ver el PPA" })).toHaveAttribute("href", "/prevencion/ppa/ppa-9")
    // Lo que el servidor sí acepta para este origen sigue disponible.
    expect(screen.getByText("Agregar evidencia")).toBeInTheDocument()
    expect(screen.getByText("Conciliación histórica")).toBeInTheDocument()
  })

  it("mantiene los controles de transición para cualquier otro origen", () => {
    render(<CapaControls action={{
      id: "c1", version: 1, status: "pending_verification", priority: "medium", targetDate: "2026-08-01",
      responsibleUserId: null, reconciliationStatus: "reconciled",
      sourceType: "incident", sourceId: "inc-3",
    }} users={[]} permissions={all} />)

    expect(screen.getByText("Verificar eficacia")).toBeInTheDocument()
    expect(screen.getByText("Asignación y plazo")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "ver el PPA" })).not.toBeInTheDocument()
  })
})

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

describe("CapaControls permission visibility", () => {
  it("hides implementation and closure controls without their permissions", () => {
    const { rerender } = render(<CapaControls action={{
      id: "c1", version: 1, status: "pending", priority: "medium", targetDate: "2026-08-01",
      responsibleUserId: null, reconciliationStatus: "reconciled",
    }} users={[]} permissions={none} />)
    expect(screen.queryByText("Iniciar implementación")).not.toBeInTheDocument()

    rerender(<CapaControls action={{
      id: "c1", version: 2, status: "verified", priority: "medium", targetDate: "2026-08-01",
      responsibleUserId: null, reconciliationStatus: "reconciled",
    }} users={[]} permissions={none} />)
    expect(screen.queryByText("Cerrar CAPA")).not.toBeInTheDocument()
  })

  it("shows closure only with the dedicated permission", () => {
    render(<CapaControls action={{
      id: "c1", version: 2, status: "verified", priority: "medium", targetDate: "2026-08-01",
      responsibleUserId: null, reconciliationStatus: "reconciled",
    }} users={[]} permissions={{ ...none, close: true }} />)
    expect(screen.getByText("Cerrar CAPA")).toBeInTheDocument()
  })
})

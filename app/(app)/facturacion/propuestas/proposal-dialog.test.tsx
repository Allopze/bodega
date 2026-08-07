// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("./actions", () => ({ saveProposalAction: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { ProposalDialog } from "./proposal-dialog"

const CONTRACT = {
  id: "ctr-1",
  clientId: "cli-1",
  code: "CTR-0001",
  name: "Mantención",
  worksiteId: "w1",
  costCenterId: "cc1",
  currency: "CLP",
  periodAmount: null,
  clientPoNumber: "OC-999",
}

function hidden(container: HTMLElement, name: string) {
  return (container.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value
}

function choose(field: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: field }))
  fireEvent.click(screen.getByRole("option", { name: option }))
}

describe("ProposalDialog", () => {
  it("precarga faena y centro de costo al elegir el contrato", () => {
    render(
      <ProposalDialog
        clients={[{ id: "cli-1", name: "Forestal Sur", rut: "76.000.000-0" }]}
        contracts={[CONTRACT]}
        worksites={[{ id: "w1", name: "Faena Norte" }]}
        costCenters={[{ id: "cc1", code: "CC-1", name: "Cosecha" }]}
        defaultPeriod="2026-08"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Nueva propuesta" }))
    const dialog = screen.getByRole("dialog")

    choose("Cliente", "Forestal Sur")
    choose("Contrato", "CTR-0001 · Mantención")

    // Lo que viaja en el FormData a saveProposalAction.
    expect(hidden(dialog, "worksiteId")).toBe("w1")
    expect(hidden(dialog, "costCenterId")).toBe("cc1")
  })

  it("no siembra una faena fuera del alcance visible del usuario", () => {
    render(
      <ProposalDialog
        clients={[{ id: "cli-1", name: "Forestal Sur", rut: "76.000.000-0" }]}
        contracts={[{ ...CONTRACT, worksiteId: "w-ajena" }]}
        worksites={[{ id: "w1", name: "Faena Norte" }]}
        costCenters={[{ id: "cc1", code: "CC-1", name: "Cosecha" }]}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Nueva propuesta" }))
    const dialog = screen.getByRole("dialog")

    choose("Cliente", "Forestal Sur")
    choose("Contrato", "CTR-0001 · Mantención")

    // `listActiveContracts` no filtra por alcance: un id sin opción sería un
    // valor invisible que el servidor rechaza con "No tienes acceso a esa faena".
    expect(hidden(dialog, "worksiteId")).toBe("")
    expect(hidden(dialog, "costCenterId")).toBe("cc1")
  })
})

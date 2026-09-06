// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ReporteGestionFilters } from "./reporte-gestion-filters"

const mockReplace = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mockReplace }) }))

afterEach(() => {
  cleanup()
  mockReplace.mockClear()
})

const WORKSITES = [{ id: "ws-1", name: "Faena A" }, { id: "ws-2", name: "Faena B" }]

describe("ReporteGestionFilters", () => {
  it("navigates preserving other filters when the faena changes", () => {
    render(
      <ReporteGestionFilters
        programId="prog-1"
        worksites={WORKSITES}
        responsibleOptions={[{ value: "prf", label: "PRF" }]}
        activityOptions={[]}
        current={{ faena: "ws-1", responsable: "prf" }}
      />,
    )

    fireEvent.click(screen.getByLabelText("Faena"))
    fireEvent.click(screen.getByText("Faena B"))

    expect(mockReplace).toHaveBeenCalledWith("/prevencion/pdtp/prog-1/reporte?faena=ws-2&responsable=prf", { scroll: false })
  })

  it("navigates with the estado filter set", () => {
    render(
      <ReporteGestionFilters
        programId="prog-1"
        worksites={WORKSITES}
        responsibleOptions={[]}
        activityOptions={[]}
        current={{ faena: "ws-1" }}
      />,
    )

    fireEvent.click(screen.getByLabelText("Estado"))
    fireEvent.click(screen.getByText("En desviación"))

    expect(mockReplace).toHaveBeenCalledWith("/prevencion/pdtp/prog-1/reporte?faena=ws-1&estado=deviates", { scroll: false })
  })

  it("clears a filter when 'todos' is selected again", () => {
    render(
      <ReporteGestionFilters
        programId="prog-1"
        worksites={WORKSITES}
        responsibleOptions={[]}
        activityOptions={[]}
        current={{ faena: "ws-1", estado: "deviates" }}
      />,
    )

    fireEvent.click(screen.getByLabelText("Estado"))
    fireEvent.click(screen.getByText("Todos los estados"))

    expect(mockReplace).toHaveBeenCalledWith("/prevencion/pdtp/prog-1/reporte?faena=ws-1", { scroll: false })
  })
})

// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { EMPTY_FILTERS } from "@/lib/prevention/miper/grid-view"

vi.mock("next/navigation", () => ({ usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("") }))

import { MatrixFiltersBar } from "./matrix-filters-bar"

const props = { riskFactors: [{ id: "f1", name: "Caídas" }], hasBaseline: false, collapsedAll: false, onToggleAll: vi.fn() }

describe("MatrixFiltersBar", () => {
  it("un factor de la URL que no es de la matriz no genera chip", () => {
    render(<MatrixFiltersBar {...props} filters={{ ...EMPTY_FILTERS, factorId: "basura" }} />)
    expect(screen.queryByText("Factor:")).toBeNull()
    expect(screen.queryByRole("button", { name: "Eliminar filtro Factor" })).toBeNull()
  })
  it("un factor conocido sí muestra su chip", () => {
    render(<MatrixFiltersBar {...props} filters={{ ...EMPTY_FILTERS, factorId: "f1" }} />)
    expect(screen.getByRole("button", { name: "Eliminar filtro Factor" })).toBeTruthy()
    expect(screen.getByText("Caídas")).toBeTruthy()
  })
})

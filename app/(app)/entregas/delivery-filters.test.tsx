// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/entregas",
  useSearchParams: () => new URLSearchParams("q=Eduardo&page=3"),
  useRouter: () => ({ replace: vi.fn() }),
}))

import { DeliveryFilters } from "./delivery-filters"

describe("DeliveryFilters (BOD-01)", () => {
  it("ofrece la búsqueda de servidor y muestra la búsqueda activa como chip", () => {
    render(<DeliveryFilters worksites={[{ id: "w1", name: "Faena E2E" }]} faena="" q="Eduardo" />)

    expect(screen.getByRole("searchbox", { name: "Buscar en el historial de entregas" })).toHaveValue("Eduardo")
    expect(screen.getAllByText("Eduardo").length).toBeGreaterThanOrEqual(1)
  })
})

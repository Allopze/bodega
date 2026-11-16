// @vitest-environment jsdom
/**
 * La faena de la cabecera de un tablero nombra su opción «todas» según el alcance de quien mira:
 * «Todas las faenas» para quien las ve todas, «Todas tus faenas» para quien tiene un alcance
 * limitado (el servidor resuelve el rótulo con `allWorksitesLabel` y lo pasa como prop).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/mantencion/panel",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/components/layout/header-context", () => ({ useWorksiteFilterPresence: () => undefined }))

import { BoardScope } from "@/components/dashboard/board-scope"

const WORKSITES = [{ id: "ws-1", name: "Faena Norte" }, { id: "ws-2", name: "Faena Sur" }]

afterEach(() => cleanup())

describe("BoardScope · rótulo de «todas las faenas»", () => {
  it("sin rótulo explícito lee «Todas las faenas»", () => {
    render(<BoardScope worksites={WORKSITES} worksiteId={null} period={<span>Período</span>} />)
    expect(screen.getByRole("combobox", { name: "Faena del tablero" })).toHaveTextContent("Todas las faenas")
  })

  it("con alcance limitado lee «Todas tus faenas», en el valor y en la lista", () => {
    render(<BoardScope worksites={WORKSITES} worksiteId={null} period={<span>Período</span>} allLabel="Todas tus faenas" />)
    const trigger = screen.getByRole("combobox", { name: "Faena del tablero" })
    expect(trigger).toHaveTextContent("Todas tus faenas")
    fireEvent.click(trigger)
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Todas tus faenas", "Faena Norte", "Faena Sur"])
  })
})

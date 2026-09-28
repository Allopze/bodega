// @vitest-environment jsdom
/**
 * A1: los cuatro KPI de Gestión del cambio eran `div` con un "0" pelado. Ahora
 * cada uno es un `button aria-pressed` que filtra la lista (`?vista=`) y en
 * cero afirma el estado en vez de mostrar un número sin contexto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ChangeList } from "./change-list"

const replace = vi.fn()
let search = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => search,
  usePathname: () => "/prevencion/gestion-cambio",
}))

beforeEach(() => { replace.mockClear(); search = new URLSearchParams() })
afterEach(cleanup)

const change = (id: string, status: string, riskLevel = "medium") => ({
  id, code: `GC-${id}`, title: `Cambio ${id}`, changeType: "supplier", status, riskLevel, worksiteName: "Faena A", evaluatedCount: 0,
})
const CHANGES = [change("a", "draft"), change("b", "approved", "high"), change("c", "approved")]

function tile(name: RegExp) {
  return screen.getByRole("button", { name })
}

describe("ChangeList — KPI accionables", () => {
  it("cada tile con valor es un filtro pulsable", () => {
    render(<ChangeList changes={CHANGES} worksites={[]} canManage={false} />)
    const approved = tile(/^Aprobados/)
    expect(approved).toHaveAttribute("aria-pressed", "false")
    expect(approved).toBeEnabled()
    fireEvent.click(approved)
    expect(replace).toHaveBeenCalledWith("/prevencion/gestion-cambio?vista=approved", { scroll: false })
  })

  it("en cero no muestra un 0 pelado: afirma el estado y no es clicable", () => {
    render(<ChangeList changes={CHANGES} worksites={[]} canManage={false} />)
    const rejected = tile(/^Rechazados/)
    expect(rejected).toBeDisabled()
    expect(rejected).toHaveTextContent("Ninguno rechazado")
    expect(rejected).not.toHaveTextContent("Sin proceder")
  })

  it("con ?vista= la lista muestra sólo ese subconjunto y el tile queda activo", () => {
    search = new URLSearchParams("vista=approved")
    render(<ChangeList changes={CHANGES} worksites={[]} canManage={false} />)
    expect(tile(/^Aprobados/)).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText(/2 de 3 solicitud\(es\)/)).toBeInTheDocument()
    expect(screen.queryAllByText("Cambio a")).toHaveLength(0)
    expect(screen.getAllByText("Cambio b").length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole("button", { name: "Ver todas" }))
    expect(replace).toHaveBeenCalledWith("/prevencion/gestion-cambio", { scroll: false })
  })

  it("no agrega un Select de estado (A5)", () => {
    render(<ChangeList changes={CHANGES} worksites={[]} canManage={false} />)
    expect(screen.queryByRole("combobox")).toBeNull()
  })
})

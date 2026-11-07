// @vitest-environment jsdom
/**
 * UX-02 (auditoría UI/UX 2026-11-07): a 390 px el buscador medía 358 × 16 px.
 * El `<input>` crudo llevaba `h-11 … flex-1` dentro de un `flex-col`: en columna
 * `flex-1` (base 0) anula la altura, y con `text-xs` iOS hacía zoom al enfocar.
 *
 * jsdom no calcula layout, así que aquí se fija el contrato que evita el
 * defecto —el campo es el `Input` compartido y `flex-1` sólo existe desde
 * `sm`—; la caja renderizada la mide `e2e/pendientes-buscador-movil.spec.ts`.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OperationalQueueResult } from "@/lib/services/operational-work-queue"

// Un solo objeto por prueba, como en la aplicación: la cola reinicia el campo
// cuando `useSearchParams()` cambia de identidad, y un mock que devuelve uno
// nuevo en cada render lo vaciaría mientras se escribe.
let params = new URLSearchParams()
const replace = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => "/pendientes",
  useSearchParams: () => params,
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))
vi.mock("@/app/(app)/prevencion/pdtp/actions/scheduled-instances", () => ({
  startPdtpScheduledInstanceAction: vi.fn(),
}))

const { WorkQueueWorkbench } = await import("./work-queue-workbench")

const EMPTY_RESULT: OperationalQueueResult = {
  items: [],
  total: 0,
  summary: { all: 0, critical: 0, overdue: 0, today: 0, blocked: 0, unassigned: 0, mine: 0, moduleCounts: {} },
  filterOptions: { modules: [], worksites: [], statuses: [] },
  nextCursor: null,
  sourceErrors: [],
  refreshedAt: "2026-11-07T12:00:00.000Z",
}

beforeEach(() => {
  params = new URLSearchParams()
  replace.mockClear()
})
afterEach(cleanup)

describe("buscador de Mis pendientes en móvil (UX-02)", () => {
  it("es el Input compartido: 44 px de alto y 16 px de letra en móvil, sin `flex-1` fuera de `sm`", () => {
    render(<WorkQueueWorkbench result={EMPTY_RESULT} />)
    const buscador = screen.getByRole("searchbox", { name: "Buscar en pendientes" })
    const clases = buscador.className.split(/\s+/)

    expect(clases).toContain("h-11")
    // 16 px exactos: `text-base` mide 15 px en esta escala e iOS igual hacía zoom.
    expect(clases).toContain("text-[1rem]")
    expect(clases).toContain("sm:text-xs")
    // `flex-1` sin prefijo era la causa: en la columna móvil fija la base en 0 y anula `h-11`.
    expect(clases).not.toContain("flex-1")
    expect(clases).toContain("sm:flex-1")
  })

  it("conserva la región de búsqueda rotulada y el botón «Buscar» de envío", () => {
    render(<WorkQueueWorkbench result={EMPTY_RESULT} />)

    expect(screen.getByRole("search")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Buscar" })).toHaveAttribute("type", "submit")
  })

  it("escribir y enviar aplica `q` en la URL sin tocar el scroll", () => {
    render(<WorkQueueWorkbench result={EMPTY_RESULT} />)

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar en pendientes" }), { target: { value: "  SOL-0063 " } })
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }))

    expect(replace).toHaveBeenCalledWith("/pendientes?q=SOL-0063", { scroll: false })
  })
})

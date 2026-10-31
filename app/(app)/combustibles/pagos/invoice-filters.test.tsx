// @vitest-environment jsdom
/**
 * Filtros de «Pagos › Facturas»: el buscador y tres filtros a la vista, el resto
 * tras «Más filtros (N)», un chip por filtro activo, y el período (que vive en la
 * cabecera) intacto al quitar o limpiar.
 */
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { InvoiceListParams } from "./invoice-params"

const mockReplace = vi.hoisted(() => vi.fn())
const mockSearch = vi.hoisted(() => ({ value: "" }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => "/combustibles/pagos",
  useSearchParams: () => new URLSearchParams(mockSearch.value),
}))

import { InvoiceFilters } from "./invoice-filters"

const none: InvoiceListParams = { q: "", faena: "", equipo: "", estado: "", servicio: "", proveedor: "", producto: "", productoId: "", pagina: 1 }

function renderFilters(current: Partial<InvoiceListParams> = {}) {
  return render(
    <InvoiceFilters
      equipment={[{ value: "veh-1", label: "CM-11 · AA-BB-11" }]}
      suppliers={[{ id: "sup-1", name: "Copec" }]}
      worksites={[{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Pacífico" }]}
      products={[{ id: "prod-1", name: "Diésel" }]}
      current={{ ...none, ...current }}
    />,
  )
}

describe("InvoiceFilters", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearch.value = "periodo=2026-10"
  })

  it("deja a la vista el buscador rotulado y tres filtros; servicio, proveedor y producto van en «Más filtros»", () => {
    renderFilters()

    expect(screen.getByRole("searchbox", { name: "Buscar factura, equipo o proveedor" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Filtrar por faena" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Filtrar por equipo" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Filtrar por estado" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Más filtros" })).toBeInTheDocument()
    expect(screen.queryByText("Tipo de tarjeta")).toBeNull()
  })

  it("cuenta los filtros que viven tras «Más filtros» y muestra un chip por cada filtro activo", () => {
    renderFilters({ estado: "draft", proveedor: "sup-1", servicio: "TAE", productoId: "prod-1" })

    expect(screen.getByRole("button", { name: "Más filtros (3 activos)" })).toBeInTheDocument()
    const chip = (label: string) => screen.getByRole("button", { name: `Eliminar filtro ${label}` }).closest("span")
    expect(chip("Estado")).toHaveTextContent("Estado:Borrador")
    expect(chip("Proveedor")).toHaveTextContent("Proveedor:Copec")
    expect(chip("Tarjeta")).toHaveTextContent("Tarjeta:Tarjeta Copec de abastecimiento")
    expect(chip("Producto")).toHaveTextContent("Producto:Diésel")
  })

  it("quitar un chip cambia la URL sin mover el scroll, conserva el período, vuelve a la página 1 y borra el nombre antiguo", () => {
    mockSearch.value = "periodo=2026-10&status=draft&estado=draft&page=3&pagina=3&proveedor=sup-1"
    renderFilters({ estado: "draft", proveedor: "sup-1" })

    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Estado" }))

    expect(mockReplace).toHaveBeenCalledTimes(1)
    const [url, options] = mockReplace.mock.calls[0]!
    expect(options).toEqual({ scroll: false })
    const params = new URL(url, "http://x").searchParams
    expect(params.get("periodo")).toBe("2026-10")
    expect(params.get("proveedor")).toBe("sup-1")
    for (const gone of ["estado", "status", "page", "pagina"]) expect(params.has(gone)).toBe(false)
  })

  it("«Limpiar filtros» quita los filtros y la búsqueda, pero no el período", () => {
    mockSearch.value = "periodo=2026-10&estado=draft&q=F-88&faena=ws-1&vehicle=veh-1"
    renderFilters({ estado: "draft", q: "F-88", faena: "ws-1", equipo: "veh-1" })

    fireEvent.click(screen.getByRole("button", { name: /limpiar filtros/i }))

    const [url] = mockReplace.mock.calls[0]!
    expect(new URL(url, "http://x").searchParams.toString()).toBe("periodo=2026-10")
  })

  it("con una sola faena no ofrece el selector de faena", () => {
    render(
      <InvoiceFilters equipment={[]} suppliers={[]} worksites={[{ id: "ws-1", name: "Biodiversa" }]} products={[]} current={none} />,
    )

    expect(screen.queryByRole("combobox", { name: "Filtrar por faena" })).toBeNull()
    expect(within(document.body).getByRole("combobox", { name: "Filtrar por equipo" })).toBeInTheDocument()
  })
})

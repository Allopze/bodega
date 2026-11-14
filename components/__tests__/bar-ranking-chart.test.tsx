// @vitest-environment jsdom

/**
 * `BarRankingChart`: el ranking de los tableros como gráfico. Con la pantalla ancha
 * dibuja barras (recharts necesita medidas que jsdom no da, así que se comprueba el
 * nombre del gráfico); bajo 360 px lo reemplaza por el mismo ranking como lista, con
 * los mismos enlaces, en el orden pedido y sin pasar de `limit`.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { NARROW_CHART_QUERY } from "@/components/charts/dense-chart"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

import { BarRankingChart, type BarRankingItem } from "@/components/charts/bar-ranking-chart"

const original = window.matchMedia

function viewport(narrow: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: narrow && query === NARROW_CHART_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

afterEach(() => {
  cleanup()
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: original })
})

const ITEMS: BarRankingItem[] = [
  { key: "b", label: "CA-16", value: 17_312, href: "/flota/b" },
  { key: "a", label: "CA-17", value: 18_142, href: "/flota/a" },
  { key: "c", label: "CA-18", value: 17_224, href: "/flota/c" },
]

describe("BarRankingChart", () => {
  it("sin filas no dibuja nada (la celda del panel se oculta)", () => {
    viewport(false)
    const { container } = render(<BarRankingChart items={[]} ariaLabel="Equipos con más km" unit=" km" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("con la pantalla ancha es un gráfico con nombre", () => {
    viewport(false)
    render(<BarRankingChart items={ITEMS} ariaLabel="Equipos con más km" unit=" km" />)
    expect(screen.getByRole("img", { name: /Equipos con más km/ })).toBeInTheDocument()
  })

  it("bajo 360 px es la misma lista, de mayor a menor, con sus enlaces y sin pasar del límite", () => {
    viewport(true)
    render(<BarRankingChart items={ITEMS} ariaLabel="Equipos con más km" unit=" km" limit={2} />)
    expect(screen.queryByRole("img", { name: /Equipos con más km/ })).not.toBeInTheDocument()
    const links = within(screen.getByRole("list", { name: "Equipos con más km" })).getAllByRole("link")
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/flota/a", "/flota/b"])
  })

  it("con order «input» respeta el orden de llegada (las etapas de un flujo)", () => {
    viewport(true)
    const stages: BarRankingItem[] = [
      { key: "solicitada", label: "Por asignar", value: 4, href: "/ot?estado=solicitada" },
      { key: "asignada", label: "Asignada", value: 5, href: "/ot?estado=asignada" },
    ]
    render(<BarRankingChart items={stages} ariaLabel="OT abiertas por estado" unit=" OT" order="input" />)
    const links = within(screen.getByRole("list", { name: "OT abiertas por estado" })).getAllByRole("link")
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/ot?estado=solicitada", "/ot?estado=asignada"])
  })
})

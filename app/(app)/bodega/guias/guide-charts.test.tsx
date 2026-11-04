// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { shapeGuideTransit, type GuideTransitRow } from "@/lib/bodega/guide-transit"
import { GuideCharts } from "./guide-charts"

afterEach(cleanup)

const row = (id: string, name: string, confirmed: number, median: number | null, p90: number | null, withDifferences = 0): GuideTransitRow => ({
  worksiteId: id, worksiteName: name, confirmed, median, p90, withDifferences,
})
const age = { "0-1": 2, "2-3": 1, "4-7": 1, "mas-de-7": 4 }
const base = { windowText: "En los últimos 6 meses", from: "2026-05-01", ageCounts: age, ageActive: "" as const, faena: "" }

describe("GuideCharts", () => {
  it("dos gráficos con nombre y frase: tiempo hasta confirmar y antigüedad de lo pendiente", () => {
    const transit = shapeGuideTransit([row("a", "Cholguán", 12, 6, 14), row("b", "Pacífico", 12, 1, 2)])
    render(<GuideCharts {...base} transit={transit} />)

    expect(screen.getByRole("heading", { name: "Cuánto tardan los destinos en confirmar" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Antigüedad de las guías por confirmar" })).toBeTruthy()
    expect(screen.getByText(/Cholguán es el destino que más tarda en confirmar/)).toBeTruthy()
    expect(screen.getByText("8 guías despachadas esperan confirmación; 4 llevan más de 7 días.")).toBeTruthy()
  })

  it("cada destino muestra su mediana con su P90 y su n, y lleva a sus guías confirmadas", () => {
    const transit = shapeGuideTransit([row("a", "Cholguán", 12, 6, 14)])
    render(<GuideCharts {...base} transit={transit} />)
    const list = screen.getByRole("list", { name: "Mediana de días hasta confirmar la recepción, por destino" })
    expect(within(list).getByText("P90 14 días · n = 12")).toBeTruthy()
    const link = within(list).getByRole("link", { name: /Cholguán/ })
    expect(link.getAttribute("href")).toBe("/bodega/guias?estado=received&faena=a&desde=2026-05-01")
  })

  it("un destino con pocas guías no lleva cifra: se nombra aparte con su n y «datos insuficientes»", () => {
    const transit = shapeGuideTransit([row("a", "Cholguán", 12, 6, 14), row("b", "Masisa", 2, 9, 9)])
    render(<GuideCharts {...base} transit={transit} />)
    const list = screen.getByRole("list", { name: "Mediana de días hasta confirmar la recepción, por destino" })
    expect(within(list).queryByText(/Masisa/)).toBeNull()
    expect(screen.getByText(/menos de 5 guías confirmadas\): Masisa \(n = 2\)/)).toBeTruthy()
  })

  it("con n entre 5 y 9 el P90 no se publica y dice desde cuántas guías", () => {
    const transit = shapeGuideTransit([row("a", "Cholguán", 6, 3, 5)])
    render(<GuideCharts {...base} transit={transit} />)
    expect(screen.getByText("n = 6 · P90 desde 10 guías")).toBeTruthy()
  })

  it("cada tramo de espera filtra la lista y descarta fechas y búsqueda", () => {
    render(<GuideCharts {...base} transit={shapeGuideTransit([])} faena="ws-1" />)
    const link = screen.getByRole("link", { name: /Más de 7 días/ })
    expect(link.getAttribute("href")).toBe("/bodega/guias?estado=dispatched&faena=ws-1&antiguedad=mas-de-7")
  })

  it("con un tramo elegido se marca, elegirlo otra vez lo quita y hay una salida explícita", () => {
    render(<GuideCharts {...base} transit={shapeGuideTransit([])} ageActive="mas-de-7" faena="ws-1" />)
    const active = screen.getByRole("link", { name: /Más de 7 días/ })
    expect(active.getAttribute("aria-current")).toBe("true")
    expect(active.getAttribute("href")).toBe("/bodega/guias?estado=dispatched&faena=ws-1")
    expect(screen.getByRole("link", { name: "Quitar filtro" })).toBeTruthy()
  })

  it("sin ninguna guía confirmada explica el vacío con una salida (A4) y la otra barra sigue", () => {
    render(<GuideCharts {...base} transit={shapeGuideTransit([])} />)
    expect(screen.getByText("Ninguna guía confirmada en este período")).toBeTruthy()
    expect(screen.getAllByRole("link", { name: /Ver todas las guías/ }).length).toBeGreaterThan(0)
    expect(screen.getByText(/8 guías despachadas/)).toBeTruthy()
  })

  it("sin nada confirmado ni pendiente no dibuja nada: la página ya explica su vacío", () => {
    const { container } = render(<GuideCharts {...base} transit={shapeGuideTransit([])} ageCounts={{ "0-1": 0, "2-3": 0, "4-7": 0, "mas-de-7": 0 }} />)
    expect(container.firstChild).toBeNull()
  })
})

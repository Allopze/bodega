// @vitest-environment jsdom
/**
 * Evidencia de «Por revisar» › lecturas del medidor (CHART-023c): un sparkline con
 * la lectura que retrocede marcada. El dibujo es decoración: los números siguen
 * en las tarjetas, que son su alternativa en texto.
 */
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { FuelInboxEvidence } from "@/lib/combustibles/inbox/types"
import { InboxEvidence } from "./inbox-evidence"

afterEach(() => cleanup())

type Readings = Extract<FuelInboxEvidence, { type: "readings" }>

const READINGS: Readings = {
  type: "readings",
  unit: "km",
  points: [
    { at: "2026-03-01T15:00:00.000Z", reading: 1000, current: false },
    { at: "2026-03-02T15:00:00.000Z", reading: 1200, current: false },
    { at: "2026-03-03T15:00:00.000Z", reading: 900, current: true },
    { at: "2026-03-04T15:00:00.000Z", reading: 1300, current: false },
  ],
}

describe("evidencia de lecturas del medidor", () => {
  it("dibuja el sparkline con un punto sobre la lectura de esta carga", () => {
    const { container } = render(<InboxEvidence evidence={[READINGS]} />)
    const region = screen.getByRole("region", { name: "Últimas lecturas del medidor" })
    const chart = region.querySelector("svg")!
    expect(chart).not.toBeNull()
    // Decorativo: el lector de pantalla recibe las tarjetas, no el dibujo.
    expect(chart.getAttribute("aria-hidden")).toBe("true")

    const dot = container.querySelector("line[data-marked]")!
    expect(dot).not.toBeNull()
    // La carga actual es la tercera de cuatro lecturas (x = 2/3 del ancho) y la más baja (abajo del todo).
    expect(Number(dot.getAttribute("x1"))).toBeCloseTo((80 * 2) / 3, 1)
    expect(Number(dot.getAttribute("y1"))).toBe(26)
  })

  it("los números siguen en texto: una tarjeta por lectura, con la de esta carga rotulada, y cuánto bajó", () => {
    render(<InboxEvidence evidence={[READINGS]} />)
    const region = screen.getByRole("region", { name: "Últimas lecturas del medidor" })
    const cards = within(region).getAllByRole("listitem")
    expect(cards).toHaveLength(4)
    expect(within(cards[2]!).getByText("Esta carga")).toBeInTheDocument()
    expect(within(cards[2]!).getByText(/900/)).toBeInTheDocument()
    expect(within(region).getByText(/Bajó/)).toHaveTextContent("Bajó 300 km")
  })

  it("con una sola lectura no hay línea que dibujar y las tarjetas siguen", () => {
    const single: Readings = { ...READINGS, points: [{ at: "2026-03-03T15:00:00.000Z", reading: 900, current: true }] }
    const { container } = render(<InboxEvidence evidence={[single]} />)
    expect(container.querySelector("svg")).toBeNull()
    expect(screen.getAllByRole("listitem")).toHaveLength(1)
  })

  it("si ninguna lectura es la de esta carga, dibuja la línea sin punto", () => {
    const none: Readings = { ...READINGS, points: READINGS.points.map((point) => ({ ...point, current: false })) }
    const { container } = render(<InboxEvidence evidence={[none]} />)
    expect(container.querySelector("svg")).not.toBeNull()
    expect(container.querySelector("line[data-marked]")).toBeNull()
  })
})

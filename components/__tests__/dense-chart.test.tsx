// @vitest-environment jsdom

/**
 * `DenseChart`: bajo 360 px de ancho un gráfico denso se reemplaza por su tabla o
 * por un `RankedList`. jsdom no calcula media queries, así que el test fija lo que
 * el componente decide con la respuesta de `matchMedia`: qué consulta hace, qué
 * monta y qué no.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { DenseChart, NARROW_CHART_QUERY } from "@/components/charts/dense-chart"

const original = window.matchMedia

function mockViewport(narrow: boolean) {
  const listeners = new Set<() => void>()
  const state = { narrow }
  const media = {
    get matches() { return state.narrow },
    media: NARROW_CHART_QUERY,
    addEventListener: vi.fn((_: string, cb: () => void) => listeners.add(cb)),
    removeEventListener: vi.fn((_: string, cb: () => void) => listeners.delete(cb)),
  }
  const matchMedia = vi.fn(() => media)
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: matchMedia })
  return {
    matchMedia,
    set(next: boolean) {
      state.narrow = next
      listeners.forEach((cb) => cb())
    },
  }
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: original })
})

const chart = <svg data-testid="chart" aria-label="Dispersión" />
const fallback = <ul aria-label="Ranking" data-testid="fallback"><li>KA-1</li></ul>

describe("DenseChart", () => {
  it("la consulta es «menos de 360 px» (359,98 para no dejar un hueco entre 359 y 360)", () => {
    expect(NARROW_CHART_QUERY).toBe("(max-width: 359.98px)")
  })

  it("en pantalla ancha dibuja el gráfico y no monta el reemplazo", () => {
    const viewport = mockViewport(false)
    render(<DenseChart fallback={fallback}>{chart}</DenseChart>)
    expect(screen.getByTestId("chart")).toBeDefined()
    expect(screen.queryByTestId("fallback")).toBeNull()
    expect(viewport.matchMedia).toHaveBeenCalledWith(NARROW_CHART_QUERY)
  })

  it("bajo 360 px monta el reemplazo, lo explica y no monta el gráfico", () => {
    mockViewport(true)
    render(<DenseChart fallback={fallback}>{chart}</DenseChart>)
    expect(screen.queryByTestId("chart")).toBeNull()
    expect(screen.getByTestId("fallback")).toBeDefined()
    expect(screen.getByText(/se muestra como lista/i)).toBeDefined()
  })

  it("`when={false}` deja el gráfico aunque la pantalla sea angosta (pocos datos, no es denso)", () => {
    mockViewport(true)
    render(<DenseChart when={false} fallback={fallback}>{chart}</DenseChart>)
    expect(screen.getByTestId("chart")).toBeDefined()
    expect(screen.queryByTestId("fallback")).toBeNull()
  })

  it("cambia en vivo al redimensionar o girar el teléfono", () => {
    const viewport = mockViewport(false)
    render(<DenseChart fallback={fallback}>{chart}</DenseChart>)
    expect(screen.getByTestId("chart")).toBeDefined()
    act(() => viewport.set(true))
    expect(screen.queryByTestId("chart")).toBeNull()
    expect(screen.getByTestId("fallback")).toBeDefined()
    act(() => viewport.set(false))
    expect(screen.getByTestId("chart")).toBeDefined()
  })

  it("sin matchMedia (servidor) dibuja el gráfico: el primer render coincide con la hidratación", () => {
    Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: undefined })
    render(<DenseChart fallback={fallback}>{chart}</DenseChart>)
    expect(screen.getByTestId("chart")).toBeDefined()
  })
})

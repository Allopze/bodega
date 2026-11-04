// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { buildLphComparison } from "@/lib/combustibles/control/calc/lph-comparison"
import type { LitersPerHourComparisonRow } from "@/lib/combustibles/control/queries/idle-comparison"

// Recharts de verdad salvo el contenedor: jsdom no mide y sin tamaño no dibuja.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) => React.cloneElement(children, { width: 640, height: 288 }),
  }
})

import { LphScatterChart } from "./lph-scatter-chart"

// `useChartMotion` anima la entrada salvo con «reducir movimiento». Estas pruebas leen el SVG ya
// terminado (alturas, formas, rótulos), así que corren con esa preferencia activa: es el estado que
// una animación de ≤ 200 ms alcanza de todos modos, sin esperar cuadros que jsdom no entrega.
const originalMatchMedia = window.matchMedia
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: originalMatchMedia })
})

const row = (vehicleId: string, month: string, telemetryLph: number, loadsLph: number): LitersPerHourComparisonRow => ({
  vehicleId, equipment: `${vehicleId.toUpperCase()} · PL-${vehicleId}`, month, telemetryLph, loadsLph, loadCount: 2, differencePct: null,
})

const VIEW = buildLphComparison([
  row("a", "2026-03", 10.5, 10), // dentro
  row("b", "2026-03", 9.5, 10), // dentro
  row("c", "2026-03", 18, 10), // fuera, mide más
  row("d", "2026-04", 5, 10), // fuera, mide menos
])

describe("LphScatterChart", () => {
  it("es una imagen con nombre que cuenta cuántos puntos están dentro y fuera de la banda", () => {
    render(<LphScatterChart view={VIEW} />)

    expect(screen.getByRole("img", { name: /2 dentro de la banda de ±15 % y 2 fuera/ })).toBeInTheDocument()
  })

  it("dibuja la diagonal y las dos rectas de la banda", () => {
    const { container } = render(<LphScatterChart view={VIEW} />)

    expect(container.querySelectorAll(".recharts-reference-line")).toHaveLength(3)
  })

  it("un punto por par: círculos dentro de la banda y rombos fuera, para que la forma también lo diga", () => {
    const { container } = render(<LphScatterChart view={VIEW} />)

    const symbols = Array.from(container.querySelectorAll("path.recharts-symbols"))
    expect(symbols).toHaveLength(4)
    // Los dos del centro son círculos (arco «A»); los dos fuera, rombos (cuatro segmentos «L»).
    const circles = symbols.filter((node) => (node.getAttribute("d") ?? "").includes("A"))
    expect(circles).toHaveLength(2)
  })

  it("rotula los puntos fuera de la banda con el equipo y el mes; los de dentro quedan sin rótulo", () => {
    const { container } = render(<LphScatterChart view={VIEW} />)

    const texts = Array.from(container.querySelectorAll("text")).map((node) => node.textContent ?? "")
    expect(texts).toEqual(expect.arrayContaining(["C · mar", "D · abr"]))
    expect(texts).not.toContain("A · mar")
  })

  it("los dos ejes llevan la misma unidad y la misma escala (L/h)", () => {
    const { container } = render(<LphScatterChart view={VIEW} />)

    const texts = Array.from(container.querySelectorAll("text")).map((node) => node.textContent ?? "")
    expect(texts).toEqual(expect.arrayContaining(["L/h según las cargas", "L/h según la telemetría"]))
  })

  it("no pone un foco ni un enlace dentro de la imagen", () => {
    const { container } = render(<LphScatterChart view={VIEW} />)

    const chart = screen.getByRole("img", { name: /Litros por hora/ })
    expect(chart.querySelector('[tabindex="0"]')).toBeNull()
    expect(chart.querySelector('[role="application"]')).toBeNull()
    expect(chart.querySelector("a")).toBeNull()
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(0)
  })
})

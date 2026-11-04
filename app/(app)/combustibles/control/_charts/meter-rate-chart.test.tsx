// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { MeterRateMonth, MeterRateSeries } from "@/lib/combustibles/meter-rate-series"

// Recharts de verdad salvo el contenedor: jsdom no mide y sin tamaño no dibuja.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) => React.cloneElement(children, { width: 640, height: 256 }),
  }
})

import { MeterRateChart } from "./meter-rate-chart"

afterEach(() => cleanup())

const month = (overrides: Partial<MeterRateMonth> & { month: string }): MeterRateMonth => ({
  measure: 400, liters: 160, segments: 4, equipment: 2, discarded: 0, rate: 2.5, status: "ok", partial: false, ...overrides,
})
const GAP = { status: "gap", rate: null, segments: 0, measure: 0, liters: 0, equipment: 0 } as const

const series = (months: MeterRateMonth[], overrides: Partial<MeterRateSeries> = {}): MeterRateSeries => ({
  unit: "km_per_liter", months, rate: 2.5, measure: 800, liters: 320, segments: 8, equipment: 2, discarded: 0, readings: 12, status: "ok", ...overrides,
})

const SERIES = series([
  month({ month: "2026-07", rate: 2.4 }),
  month({ month: "2026-08", rate: 2.6, segments: 6 }),
  month({ month: "2026-09", ...GAP }),
  month({ month: "2026-10", rate: 2.5, partial: true }),
])

const axisText = (container: HTMLElement) => Array.from(container.querySelectorAll("text")).map((node) => node.textContent ?? "")

describe("MeterRateChart", () => {
  it("es una imagen con nombre que dice la unidad y que cada mes lleva su n", () => {
    render(<MeterRateChart series={SERIES} />)

    expect(screen.getByRole("img", { name: /^Rendimiento por mes en km\/L, de Jul 26 a Oct 26/ })).toBeInTheDocument()
  })

  it("bajo cada mes del eje va su n, y «sin datos» donde el proveedor no trajo nada", () => {
    const { container } = render(<MeterRateChart series={SERIES} />)

    const text = axisText(container)
    expect(text).toEqual(expect.arrayContaining(["Jul 26", "n=4", "Ago 26", "n=6", "Sep 26", "sin datos", "Oct 26"]))
  })

  it("el mes sin datos corta la línea en vez de bajarla a cero: son dos trazos", () => {
    const { container } = render(<MeterRateChart series={series([
      month({ month: "2026-07", rate: 2.4 }),
      month({ month: "2026-08", rate: 2.6 }),
      month({ month: "2026-09", ...GAP }),
      month({ month: "2026-10", rate: 2.5 }),
      month({ month: "2026-11", rate: 2.7 }),
    ])} />)

    const paths = Array.from(container.querySelectorAll("path.recharts-line-curve")).map((node) => node.getAttribute("d") ?? "")
    // Un M por trazo: la línea no atraviesa el hueco.
    const subpaths = paths.flatMap((d) => d.split("M").filter(Boolean))
    expect(subpaths).toHaveLength(2)
    // Cuatro puntos con valor; el hueco no tiene punto.
    expect(container.querySelectorAll("circle.recharts-dot")).toHaveLength(4)
  })

  it("dibuja la banda de ±10 % y la línea del global cuando hay rendimiento global", () => {
    const { container } = render(<MeterRateChart series={SERIES} />)

    expect(container.querySelector(".recharts-reference-area")).not.toBeNull()
    expect(container.querySelector(".recharts-reference-line")).not.toBeNull()
  })

  it("sin rendimiento global (datos insuficientes) no inventa una banda", () => {
    const { container } = render(<MeterRateChart series={series([
      month({ month: "2026-10", status: "insufficient", rate: null, segments: 2 }),
    ], { rate: null, status: "insufficient" })} />)

    expect(container.querySelector(".recharts-reference-area")).toBeNull()
    expect(container.querySelector(".recharts-reference-line")).toBeNull()
    expect(container.querySelectorAll("circle.recharts-dot")).toHaveLength(0)
  })

  it("el mes en curso va punteado", () => {
    const { container } = render(<MeterRateChart series={SERIES} />)

    const dashed = Array.from(container.querySelectorAll("path.recharts-line-curve")).filter((node) => node.getAttribute("stroke-dasharray"))
    expect(dashed.length).toBeGreaterThan(0)
  })

  it("el tooltip de un mes sin datos dice que no es un cero, y el de uno insuficiente no da una cifra", async () => {
    const { container } = render(<MeterRateChart series={series([
      month({ month: "2026-08", rate: 2.6 }),
      month({ month: "2026-09", ...GAP }),
      month({ month: "2026-10", status: "insufficient", rate: null, segments: 2 }),
    ])} />)
    const wrapper = container.querySelector<HTMLElement>(".recharts-wrapper")!
    wrapper.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 256, right: 640, bottom: 256, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    const hoverAt = (x: number) => {
      fireEvent.mouseEnter(wrapper, { clientX: x, clientY: 100 })
      fireEvent.mouseMove(wrapper, { clientX: x, clientY: 100 })
    }

    // Tres bandas dentro del área de trazado (44 px de eje a la izquierda, 12 de margen a la derecha): centros en ≈141, 336 y 531.
    hoverAt(336)
    expect(await screen.findByText("Septiembre 2026")).toBeInTheDocument()
    expect(screen.getByText(/no es cero/)).toBeInTheDocument()

    hoverAt(531)
    expect(await screen.findByText("Octubre 2026")).toBeInTheDocument()
    expect(screen.getByText(/Datos insuficientes/)).toBeInTheDocument()
    expect(screen.getByText(/2 de 3 tramos/)).toBeInTheDocument()
  })

  it("no pone un foco dentro de la imagen: sus hijos no pueden ser interactivos", () => {
    const { container } = render(<MeterRateChart series={SERIES} />)

    const chart = screen.getByRole("img", { name: /^Rendimiento por mes/ })
    expect(chart.querySelector('[tabindex="0"]')).toBeNull()
    expect(chart.querySelector('[role="application"]')).toBeNull()
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(0)
  })
})

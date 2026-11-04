// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { fillLitersByMonth, litersMonthKeys } from "@/lib/combustibles/equipment/liters-by-month"

// Recharts de verdad, salvo el contenedor: jsdom no mide nada y sin tamaño el
// `ResponsiveContainer` se queda en 0×0 y no dibuja. Así se prueba lo que sale en el SVG
// (barras, opacidades, eje, foco) y no sólo lo que el componente le pasa a una maqueta.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) => React.cloneElement(children, { width: 640, height: 240 }),
  }
})

import { EquipmentLitersChart } from "./equipment-liters-chart"

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

/** Los 12 meses que terminan en marzo de 2026: 300 L ese mes y 100 L de agosto a enero (5 meses sin cargas). */
const MONTHS = fillLitersByMonth("2026-03", [
  ...["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"].map((month) => ({ month, liters: 100, loads: 1 })),
  { month: "2026-03", liters: 300, loads: 3 },
])
/** Todos los meses con cargas: una barra por mes. */
const FULL_MONTHS = fillLitersByMonth("2026-03", litersMonthKeys("2026-03").map((month) => ({ month, liters: 100, loads: 1 })))

const bars = (container: HTMLElement) => Array.from(container.querySelectorAll("path.recharts-rectangle"))
const opacityOf = (bar: Element) => Number(bar.getAttribute("fill-opacity"))
/** Rótulos del eje («Mar 26»): los meses que se ven bajo las barras. */
const axisMonths = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("text")).map((node) => node.textContent ?? "").filter((text) => /^[A-Z][a-z]{2} \d{2}$/.test(text))

/** Apunta con el mouse a `x` píxeles del borde izquierdo del gráfico (jsdom no mide, así que se le da el tamaño). */
function hoverAt(container: HTMLElement, x: number) {
  const wrapper = container.querySelector<HTMLElement>(".recharts-wrapper")!
  const rect = { left: 0, top: 0, width: 640, height: 240, right: 640, bottom: 240, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  wrapper.getBoundingClientRect = () => rect
  fireEvent.mouseEnter(wrapper, { clientX: x, clientY: 120 })
  fireEvent.mouseMove(wrapper, { clientX: x, clientY: 120 })
}

describe("EquipmentLitersChart", () => {
  it("es una imagen con nombre: dice de qué equipo es y resume el rango, de un extremo a otro, con su máximo", () => {
    render(<EquipmentLitersChart months={MONTHS} periodMonths={["2026-03"]} vehicleLabel="CAM-01 · AAAA11" />)

    const chart = screen.getByRole("img", { name: /^Litros por mes de CAM-01 · AAAA11/ })
    expect(chart).toHaveAccessibleName(
      "Litros por mes de CAM-01 · AAAA11, de 0 L en abril de 2025 a 300 L en marzo de 2026; el mes con más litros fue marzo de 2026 (300 L)",
    )
  })

  it("los meses del período elegido van en color pleno y el resto atenuado, sin bajar de lo legible", () => {
    const { container } = render(<EquipmentLitersChart months={FULL_MONTHS} periodMonths={["2026-03"]} vehicleLabel="CAM-01" />)

    const opacities = bars(container).map(opacityOf)
    expect(opacities).toHaveLength(12)
    // El último mes es el del período; los once anteriores son contexto.
    expect(opacities.at(-1)).toBe(1)
    expect(opacities.slice(0, -1).every((opacity) => opacity < 1 && opacity >= 0.6)).toBe(true)
  })

  it("un período de varios meses los resalta todos", () => {
    const { container } = render(<EquipmentLitersChart months={FULL_MONTHS} periodMonths={["2026-01", "2026-02", "2026-03"]} vehicleLabel="CAM-01" />)

    const opacities = bars(container).map(opacityOf)
    expect(opacities.slice(-3)).toEqual([1, 1, 1])
    expect(opacities.slice(0, -3).every((opacity) => opacity < 1)).toBe(true)
  })

  it("sin período que resaltar no atenúa ninguna barra", () => {
    const { container } = render(<EquipmentLitersChart months={FULL_MONTHS} periodMonths={[]} vehicleLabel="CAM-01" />)
    expect(bars(container).map(opacityOf)).toEqual(Array(12).fill(1))
  })

  it("un mes sin cargas no dibuja barra pero sigue en el eje: los 12 meses se ven, no sólo los que tuvieron cargas", () => {
    const { container } = render(<EquipmentLitersChart months={MONTHS} periodMonths={["2026-03"]} vehicleLabel="CAM-01" />)

    expect(bars(container)).toHaveLength(7)
    expect(axisMonths(container)).toEqual(["Abr 25", "May 25", "Jun 25", "Jul 25", "Ago 25", "Sep 25", "Oct 25", "Nov 25", "Dic 25", "Ene 26", "Feb 26", "Mar 26"])
  })

  it("con «reducir movimiento» dibuja las barras sin animación: la altura final ya está en el primer cuadro", () => {
    const { container } = render(<EquipmentLitersChart months={MONTHS} periodMonths={["2026-03"]} vehicleLabel="CAM-01" />)
    const heights = bars(container).map((bar) => Number(bar.getAttribute("height")))
    expect(heights.every((height) => height > 0)).toBe(true)
    // 300 L contra 100 L: la barra más alta mide el triple.
    expect(heights.at(-1)! / heights[0]!).toBeCloseTo(3, 1)
  })

  it("al apuntar un mes, el tooltip dice el mes completo, los litros y las cargas, y si es del período elegido", async () => {
    const { container } = render(<EquipmentLitersChart months={MONTHS} periodMonths={["2026-03"]} vehicleLabel="CAM-01" />)

    hoverAt(container, 600)
    expect(await screen.findByText("Marzo de 2026")).toBeInTheDocument()
    expect(screen.getByText("300 L")).toBeInTheDocument()
    expect(screen.getByText("3 cargas · en el período elegido")).toBeInTheDocument()
  })

  it("al apuntar un mes contexto, el tooltip no lo hace pasar por del período y uno sin cargas dice «0 L»", async () => {
    const { container } = render(<EquipmentLitersChart months={MONTHS} periodMonths={["2026-03"]} vehicleLabel="CAM-01" />)

    // Diciembre de 2025: 100 L en una carga, fuera del período elegido.
    hoverAt(container, 52 + 48 * 8 + 24)
    expect(await screen.findByText("Diciembre de 2025")).toBeInTheDocument()
    expect(screen.getByText("100 L")).toBeInTheDocument()
    expect(screen.getByText("1 carga")).toBeInTheDocument()
    expect(screen.queryByText(/en el período elegido/)).not.toBeInTheDocument()

    // Abril de 2025, el primero: sin cargas.
    hoverAt(container, 70)
    expect(await screen.findByText("Abril de 2025")).toBeInTheDocument()
    expect(screen.getByText("0 L")).toBeInTheDocument()
    expect(screen.getByText("0 cargas")).toBeInTheDocument()
  })

  it("no pone un foco dentro de la imagen: sus hijos no pueden ser interactivos", () => {
    const { container } = render(<EquipmentLitersChart months={MONTHS} periodMonths={["2026-03"]} vehicleLabel="CAM-01" />)

    const chart = screen.getByRole("img", { name: /^Litros por mes de CAM-01/ })
    expect(chart.querySelector('[tabindex="0"]')).toBeNull()
    expect(chart.querySelector('[role="application"]')).toBeNull()
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(0)
  })

  it("sin cargas en los 12 meses dice qué pasa en vez de dibujar un gráfico vacío", () => {
    const { container } = render(<EquipmentLitersChart months={fillLitersByMonth("2026-03", [])} periodMonths={["2026-03"]} vehicleLabel="CAM-01" />)

    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(container.querySelector("svg")).toBeNull()
    expect(screen.getByText("Sin cargas en los últimos 12 meses")).toBeInTheDocument()
  })

  it("sin datos (la consulta falló y llegó una lista vacía) tampoco dibuja un gráfico", () => {
    render(<EquipmentLitersChart months={[]} periodMonths={["2026-03"]} vehicleLabel="CAM-01" />)

    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByText("Sin cargas en los últimos 12 meses")).toBeInTheDocument()
  })
})

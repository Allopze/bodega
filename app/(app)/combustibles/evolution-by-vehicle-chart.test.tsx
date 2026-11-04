// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import type { VehicleEvolutionPoint } from "@/lib/combustibles/consumption-dashboard"
import { buildEvolutionPanels } from "@/lib/combustibles/evolution-panels"

// Recharts de verdad salvo el contenedor: jsdom no mide y sin tamaño no dibuja.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) => React.cloneElement(children, { width: 280, height: 128 }),
  }
})
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

import { EvolutionByVehicleChart } from "./evolution-by-vehicle-chart"

afterEach(() => cleanup())

const point = (plate: string, periodo: string, liters: number, extra: Partial<VehicleEvolutionPoint> = {}): VehicleEvolutionPoint => ({
  periodo, plate, vehicleCode: null, vehicleId: `veh-${plate}`, liters, amount: null, ...extra,
})

const MONTHS = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"]
/** Doce equipos con litros: más que los 8 paneles que caben. */
const MANY = Array.from({ length: 12 }, (_, index) => MONTHS.map((month, monthIndex) => point(`EQ-${String(index).padStart(2, "0")}`, month, 1_000 - index * 50 + monthIndex * 10))).flat()

describe("EvolutionByVehicleChart (small multiples)", () => {
  it("un panel por equipo, hasta 8, cada uno una figura con su título y su dibujo como imagen con nombre", () => {
    const { container } = render(<EvolutionByVehicleChart view={buildEvolutionPanels(MANY)} />)

    expect(container.querySelectorAll("figure")).toHaveLength(8)
    expect(screen.getAllByRole("img")).toHaveLength(8)
    expect(screen.getByRole("img", { name: /^Litros por período de EQ-00, 4\.060 L en total, de 1\.000 L el 1 may 2026 a 1\.030 L el 1 ago 2026$/ })).toBeInTheDocument()
  })

  it("nunca hay más colores que uno: el equipo lo identifica el título, no el color", () => {
    const { container } = render(<EvolutionByVehicleChart view={buildEvolutionPanels(MANY)} />)

    const strokes = new Set(Array.from(container.querySelectorAll("path.recharts-line-curve")).map((node) => node.getAttribute("stroke")))
    expect(strokes).toEqual(new Set(["var(--color-primary)"]))
    // Ni la línea ni sus puntos llevan un color fijo (la grilla trae un `#ccc` de recharts que el contenedor pisa con un token por CSS).
    const painted = Array.from(container.querySelectorAll(".recharts-line *")).flatMap((node) => [node.getAttribute("stroke"), node.getAttribute("fill")])
    expect(painted.filter((value) => value && /^#/.test(value))).toEqual([])
  })

  it("todos los paneles comparten la escala vertical", () => {
    const { container } = render(<EvolutionByVehicleChart view={buildEvolutionPanels(MANY)} />)

    // Cada eje Y llega al mismo tope: el último rótulo es el mismo en los 8 paneles.
    const tops = Array.from(container.querySelectorAll("figure")).map((figure) => {
      const ticks = Array.from(figure.querySelectorAll(".recharts-yAxis .recharts-cartesian-axis-tick-value")).map((node) => node.textContent)
      return ticks.at(-1)
    })
    expect(new Set(tops).size).toBe(1)
  })

  it("el título enlaza a la ficha del equipo y queda fuera de la imagen; sin equipo en la flota, no es un enlace", () => {
    const view = buildEvolutionPanels([
      ...MONTHS.map((month) => point("AA-0001", month, 500, { vehicleCode: "KA-1" })),
      ...MONTHS.map((month) => point("ZZ-9999", month, 300, { vehicleId: null })),
    ])
    render(<EvolutionByVehicleChart view={view} />)

    const link = screen.getByRole("link", { name: "KA-1 · AA-0001" })
    expect(link).toHaveAttribute("href", "/combustibles/consumo/equipos/veh-AA-0001")
    expect(link.closest('[role="img"]')).toBeNull()
    expect(screen.queryByRole("link", { name: "ZZ-9999" })).toBeNull()
    expect(screen.getByText("ZZ-9999")).toBeInTheDocument()
    for (const image of screen.getAllByRole("img")) {
      expect(image.querySelector("a")).toBeNull()
      expect(image.querySelector('[tabindex="0"]')).toBeNull()
    }
  })

  it("un período sin registro del equipo corta la línea en vez de bajarla a cero", () => {
    const view = buildEvolutionPanels([
      point("AA-1", "2026-05-01", 500), point("AA-1", "2026-06-01", 500), point("AA-1", "2026-08-01", 500), point("AA-1", "2026-09-01", 500),
      point("BB-2", "2026-07-01", 100),
    ])
    const { container } = render(<EvolutionByVehicleChart view={view} />)

    const first = container.querySelector("figure")!
    const subpaths = Array.from(first.querySelectorAll("path.recharts-line-curve")).flatMap((node) => (node.getAttribute("d") ?? "").split("M").filter(Boolean))
    // El 1 de julio el equipo no tiene registro: dos trazos (may–jun y ago–sep), no uno que cruza por cero.
    expect(subpaths).toHaveLength(2)
    expect(within(first).getAllByRole("img")).toHaveLength(1)
  })

  it("con un solo período explica que hace falta otro, en vez de dibujar puntos sueltos", () => {
    const { container } = render(<EvolutionByVehicleChart view={buildEvolutionPanels([point("AA-1", "2026-07-01", 500), point("BB-2", "2026-07-01", 300)])} />)

    expect(screen.getByText("Hace falta más de un período para ver la evolución")).toBeInTheDocument()
    expect(container.querySelector("svg")).toBeNull()
  })

  it("sin litros dice qué falta", () => {
    render(<EvolutionByVehicleChart view={buildEvolutionPanels([])} />)

    expect(screen.getByText("Sin litros por equipo en estos períodos")).toBeInTheDocument()
  })
})

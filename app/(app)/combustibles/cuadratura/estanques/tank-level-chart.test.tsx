// @vitest-environment jsdom
/**
 * Nivel de cada estanque en el tiempo (CHART-020, P-5). Recharts de verdad salvo el contenedor:
 * jsdom no mide y sin tamaño no dibuja. Aquí se comprueba lo que el componente decide: que cada
 * estanque tenga sus dos paneles con nombre, que la capacidad y lo que falta del período se dibujen
 * sólo cuando existen, y que bajo 360 px se reemplace por una lista.
 */
import React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) => React.cloneElement(children, { width: 640, height: 160 }),
  }
})

import { buildTankLevelView, type TankDailyFlow, type TankLevelInput } from "@/lib/combustibles/tank-level"
import { TankLevelChart } from "./tank-level-chart"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const TANKS: TankLevelInput[] = [
  { storageLocationId: "a", name: "Estanque A", capacityLiters: 20_000, openingLiters: 5_000 },
  { storageLocationId: "b", name: "Estanque B", capacityLiters: null, openingLiters: 800 },
]
const FLOWS: TankDailyFlow[] = [
  { storageLocationId: "a", day: "2026-10-02", inLiters: 10_000, outLiters: 0 },
  { storageLocationId: "a", day: "2026-10-05", inLiters: 0, outLiters: 3_000 },
  { storageLocationId: "b", day: "2026-10-03", inLiters: 0, outLiters: 200 },
]
const view = (today: string) => buildTankLevelView(TANKS, FLOWS, { from: "2026-10-01", to: "2026-10-31", today })

describe("TankLevelChart", () => {
  it("cada estanque con movimientos tiene sus dos paneles, ambos imágenes con nombre", () => {
    render(<TankLevelChart view={view("2026-11-15")} />)

    expect(screen.getAllByTestId("estanque-nivel-panel")).toHaveLength(2)
    expect(screen.getByRole("img", { name: /^Nivel de Estanque A al cierre de cada día, de 01-10-2026 a 31-10-2026, contra su capacidad de 20\.000 L/ })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /^Nivel de Estanque B al cierre de cada día/ })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Litros que entraron y salieron de Estanque A por día: las entradas hacia arriba y las salidas hacia abajo" })).toBeInTheDocument()
    expect(screen.getAllByRole("img")).toHaveLength(4)
  })

  it("dice de dónde a dónde fue cada estanque, con la flecha oculta al lector de pantalla", () => {
    render(<TankLevelChart view={view("2026-11-15")} />)

    const panel = screen.getAllByTestId("estanque-nivel-panel")[0]!
    expect(panel).toHaveTextContent("Estanque A")
    expect(panel).toHaveTextContent(/5\.000 L\s*→\s*a\s*12\.000 L/)
    // La flecha es un adorno: lo que lee el lector de pantalla es «5.000 L a 12.000 L».
    expect(panel.querySelector("[aria-hidden]")?.textContent).toBe("→")
  })

  it("la leyenda nombra la capacidad sólo si algún estanque la tiene y «lo que falta» sólo con el período en curso", () => {
    const { rerender } = render(<TankLevelChart view={view("2026-11-15")} />)
    const legend = screen.getByRole("list", { name: "Qué dibuja cada trazo" })
    expect(legend).toHaveTextContent("Capacidad")
    expect(legend).not.toHaveTextContent("Lo que falta del período")

    rerender(<TankLevelChart view={view("2026-10-10")} />)
    expect(screen.getByRole("list", { name: "Qué dibuja cada trazo" })).toHaveTextContent("Lo que falta del período")

    rerender(<TankLevelChart view={buildTankLevelView([{ ...TANKS[1]! }], FLOWS, { from: "2026-10-01", to: "2026-10-31", today: "2026-11-15" })} />)
    expect(screen.getByRole("list", { name: "Qué dibuja cada trazo" })).not.toHaveTextContent("Capacidad")
  })

  it("dibuja la capacidad como línea de referencia sólo en el estanque que la tiene", () => {
    const { container } = render(<TankLevelChart view={view("2026-11-15")} />)

    const [withCapacity, withoutCapacity] = screen.getAllByTestId("estanque-nivel-panel")
    expect(withCapacity!.querySelectorAll(".recharts-reference-line").length).toBeGreaterThan(0)
    expect(withCapacity!.textContent).toContain("Capacidad 20.000 L")
    expect(withoutCapacity!.textContent).not.toContain("Capacidad")
    expect(container.querySelector("[data-testid='estanque-nivel-lista']")).toBeNull()
  })

  it("con el período en curso sombrea lo que falta; con el período cerrado no", () => {
    const { container, rerender } = render(<TankLevelChart view={view("2026-10-10")} />)
    expect(container.querySelectorAll(".recharts-reference-area").length).toBeGreaterThan(0)

    rerender(<TankLevelChart view={view("2026-11-15")} />)
    expect(container.querySelectorAll(".recharts-reference-area")).toHaveLength(0)
  })

  it("por semana avisa que cada barra es una semana", () => {
    const weekly = buildTankLevelView(TANKS, FLOWS, { from: "2026-07-01", to: "2026-10-31", today: "2026-11-15" })
    render(<TankLevelChart view={weekly} />)

    expect(screen.getByText("Cada barra es una semana (de lunes a domingo).")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /^Nivel de Estanque A al cierre de cada semana/ })).toBeInTheDocument()
  })

  it("bajo 360 px reemplaza los paneles por una lista con lo mismo en palabras", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 359.98px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    render(<TankLevelChart view={view("2026-11-15")} />)

    expect(screen.queryByTestId("estanque-nivel-grafico")).toBeNull()
    const list = screen.getByTestId("estanque-nivel-lista")
    expect(list).toHaveTextContent("Estanque A")
    expect(list).toHaveTextContent("De 5.000 L a 12.000 L: entraron 10.000 L y salieron 3.000 L.")
  })
})

// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

// Recharts de verdad salvo el contenedor: jsdom no mide y sin tamaño no dibuja.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) => React.cloneElement(children, { width: 600, height: 240 }),
  }
})
const nav = vi.hoisted(() => ({ replace: vi.fn(), search: { current: "pestana=correctivo&desde=2026-10-01" } }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/mantencion/panel",
  useSearchParams: () => new URLSearchParams(nav.search.current),
}))

import { MonthlyWorkChart, workText } from "./monthly-work-chart"

afterEach(() => {
  cleanup()
  nav.replace.mockReset()
  nav.search.current = "pestana=correctivo&desde=2026-10-01"
})

const DATA = [
  { key: "2026-09", label: "sept 2026", count: 4 },
  { key: "2026-10", label: "oct 2026", count: 0 },
  { key: "2026-11", label: "nov 2026", count: 7, partial: true },
]

describe("MonthlyWorkChart", () => {
  it("el dibujo es una imagen con nombre y la leyenda trae un botón por mes con su cifra, también el mes sin trabajos", () => {
    render(<MonthlyWorkChart data={DATA} ariaLabel="Trabajos correctivos por mes" />)
    expect(screen.getByRole("img", { name: "Trabajos correctivos por mes. Columnas: trabajos por mes." })).toBeTruthy()
    // Ningún enlace ni botón dentro de role="img" (axe nested-interactive): los controles van en la leyenda.
    expect(screen.getByRole("img").querySelector("button, a")).toBeNull()
    expect(screen.getByRole("button", { name: /sept 2026\s*4/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /oct 2026\s*0/ })).toBeTruthy()
    // El mes en curso se rotula como parcial con texto, no sólo con una columna tenue.
    expect(screen.getByRole("button", { name: /nov 2026\s*7\s*parcial/ })).toBeTruthy()
  })

  it("el botón de un mes emite x_mes sin tocar el resto de los filtros; el mes vigente lo quita", () => {
    render(<MonthlyWorkChart data={DATA} ariaLabel="Trabajos correctivos por mes" />)
    fireEvent.click(screen.getByRole("button", { name: /sept 2026/ }))
    const href = nav.replace.mock.calls[0]![0] as string
    const params = new URLSearchParams(href.split("?")[1])
    expect(params.get("x_mes")).toBe("2026-09")
    expect(params.get("desde")).toBe("2026-10-01")
    expect(nav.replace.mock.calls[0]![1]).toEqual({ scroll: false })

    cleanup()
    nav.replace.mockReset()
    nav.search.current = "pestana=correctivo&x_mes=2026-09&page=3"
    render(<MonthlyWorkChart data={DATA} ariaLabel="Trabajos correctivos por mes" selectedKey="2026-09" />)
    const pressed = screen.getByRole("button", { name: /sept 2026/ })
    expect(pressed.getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: /oct 2026/ }).getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(pressed)
    const next = new URLSearchParams((nav.replace.mock.calls[0]![0] as string).split("?")[1])
    expect(next.has("x_mes")).toBe(false)
    expect(next.has("page")).toBe(false)
  })

  it("sin meses no dibuja nada", () => {
    const { container } = render(<MonthlyWorkChart data={[]} ariaLabel="Trabajos correctivos por mes" />)
    expect(container.innerHTML).toBe("")
  })

  it("concuerda «trabajo» con la cantidad", () => {
    expect(workText(1)).toBe("1 trabajo")
    expect(workText(0)).toBe("0 trabajos")
    expect(workText(12)).toBe("12 trabajos")
  })
})

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
const nav = vi.hoisted(() => ({ replace: vi.fn(), search: "pestana=preventivo" }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/mantencion/panel",
  useSearchParams: () => new URLSearchParams(nav.search),
}))

import { MonthlyComplianceChart, shortMonthLabel } from "./monthly-compliance-chart"

afterEach(() => { cleanup(); nav.replace.mockReset(); nav.search = "pestana=preventivo" })

const DATA = [
  { key: "2026-09", label: "sept 2026", percent: null, checks: 0 },
  { key: "2026-10", label: "oct 2026", percent: 96.3, checks: 4 },
  { key: "2026-11", label: "nov 2026", percent: 88, checks: 2, partial: true },
]

describe("MonthlyComplianceChart", () => {
  it("el eje va de 0 a 100 %, aunque todos los meses cumplan sobre 90", () => {
    const { container } = render(<MonthlyComplianceChart data={DATA} ariaLabel="Cumplimiento por mes" />)
    const ticks = container.querySelector(".recharts-yAxis-tick-labels")?.querySelectorAll(".recharts-cartesian-axis-tick-value") ?? []
    expect(Array.from(ticks).map((tick) => tick.textContent)).toEqual(["0%", "25%", "50%", "75%", "100%"])
  })

  it("el dibujo es una imagen con nombre y los meses con pautas son botones; el mes sin pautas no tiene botón", () => {
    render(<MonthlyComplianceChart data={DATA} ariaLabel="Cumplimiento por mes" />)
    expect(screen.getByRole("img", { name: /Cumplimiento por mes\. Columnas/ })).toBeTruthy()
    const buttons = screen.getAllByRole("button")
    expect(buttons.map((button) => button.textContent)).toEqual(["oct 202696%, 4 pautas", "nov 202688%, 2 pautasparcial"])
    expect(screen.getByRole("img").querySelector("button, a")).toBeNull()
  })

  it("un botón emite x_mes con replace y un segundo clic lo quita", () => {
    render(<MonthlyComplianceChart data={DATA} ariaLabel="Cumplimiento por mes" />)
    fireEvent.click(screen.getAllByRole("button")[0]!)
    expect(nav.replace).toHaveBeenCalledWith("/mantencion/panel?pestana=preventivo&x_mes=2026-10", { scroll: false })
    nav.search = "pestana=preventivo&x_mes=2026-10"
    cleanup()
    render(<MonthlyComplianceChart data={DATA} ariaLabel="Cumplimiento por mes" selectedKey="2026-10" />)
    const pressed = screen.getAllByRole("button")[0]!
    expect(pressed.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(pressed)
    expect(nav.replace).toHaveBeenLastCalledWith("/mantencion/panel?pestana=preventivo", { scroll: false })
  })

  it("acorta el año del rótulo", () => {
    expect(shortMonthLabel("oct 2026")).toBe("oct 26")
  })
})

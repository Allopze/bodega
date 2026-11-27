// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/mantencion/panel",
  useSearchParams: () => new URLSearchParams(),
}))

import { mechanicAction } from "@/lib/services/mantencion/looker/filter-hrefs"
import { CrossFilterBars } from "./cross-filter-bars"

afterEach(cleanup)

const bars = (items: Parameters<typeof CrossFilterBars>[0]["items"]) =>
  render(
    <CrossFilterBars
      ariaLabel="% de cumplimiento por faena y mecánico"
      items={items}
      unit="%"
      mode="percent"
      actionFor={(item) => mechanicAction("ws-1", item.sublabel ?? item.label, false)}
    />,
  )

describe("CrossFilterBars · etiqueta de dos líneas", () => {
  it("pone la faena y el mecánico en líneas propias, sin perder el nombre accesible ni el title", () => {
    bars([{ key: "ws-1|pedro", label: "Santa Fe", sublabel: "PEDRO SOTO RAMIREZ", value: 86, detail: "2 pautas" }])
    const button = screen.getByRole("button", { name: "Santa Fe · PEDRO SOTO RAMIREZ: 86%" })
    expect(button.getAttribute("title")).toBe("Santa Fe · PEDRO SOTO RAMIREZ · 2 pautas")
    expect(screen.getByText("Santa Fe")).not.toBe(screen.getByText("PEDRO SOTO RAMIREZ"))
    expect(screen.getByText("Santa Fe").parentElement).toBe(screen.getByText("PEDRO SOTO RAMIREZ").parentElement)
  })

  it("una etiqueta sin segunda línea queda como estaba", () => {
    bars([{ key: "2026-10", label: "oct 2026", value: 40 }])
    const button = screen.getByRole("button", { name: "oct 2026: 40%" })
    expect(button.getAttribute("title")).toBe("oct 2026")
    expect(screen.queryAllByText(/·/)).toHaveLength(0)
  })
})

describe("CrossFilterBars · texto propio de la cifra", () => {
  const items = [
    { key: "v-1", label: "KA-135", value: -14_394, tone: "danger" as const },
    { key: "v-2", label: "KA-136", value: -300, tone: "ok" as const },
    { key: "v-3", label: "KA-137", value: 360, tone: "ok" as const },
  ]
  const text = (item: { value: number; tone?: string }) =>
    item.tone === "ok" && Math.abs(item.value) < 400 && item.value < 0 ? "A tiempo"
      : item.value < 0 ? `${Math.abs(item.value)} km tarde` : `${item.value} km antes`

  it("`format` reemplaza la cifra visible y el nombre accesible, en modo delta", () => {
    render(
      <CrossFilterBars
        ariaLabel="¿Se hizo a tiempo la última mantención?"
        items={items}
        mode="delta"
        format={text}
        actionFor={(item) => ({ values: { x_equipo: item.key }, active: false })}
      />,
    )
    expect(screen.getByRole("button", { name: "KA-135: 14394 km tarde" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "KA-136: A tiempo" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "KA-137: 360 km antes" })).toBeTruthy()
    expect(screen.getByText("A tiempo")).toBeTruthy()
  })

  it("sin `format` sigue mostrando el número con su unidad", () => {
    render(
      <CrossFilterBars
        ariaLabel="Delta"
        items={[items[0]!]}
        unit=" km"
        mode="delta"
        actionFor={(item) => ({ values: { x_equipo: item.key }, active: false })}
      />,
    )
    expect(screen.getByRole("button", { name: "KA-135: -14.394 km" })).toBeTruthy()
  })
})

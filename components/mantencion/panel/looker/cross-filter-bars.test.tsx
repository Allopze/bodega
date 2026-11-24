// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/mantencion/panel",
  useSearchParams: () => new URLSearchParams(),
}))

import { mechanicAction } from "@/lib/services/mantencion/looker/filters"
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

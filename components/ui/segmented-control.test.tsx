// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SegmentedControl } from "./segmented-control"

describe("SegmentedControl", () => {
  it("agrupa botones de filtro sin falsear un landmark nav", () => {
    render(<SegmentedControl ariaLabel="Faenas" items={[{ key: "all", label: "Todas", active: true, onClick: vi.fn() }]} />)
    expect(screen.getByRole("group", { name: "Faenas" }).tagName).toBe("DIV")
    expect(screen.queryByRole("navigation")).toBeNull()
    expect(screen.getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true")
  })
  it("los enlaces mantienen landmark de navegación y página actual", () => {
    render(<SegmentedControl ariaLabel="Vistas" items={[{ key: "all", label: "Todas", active: true, href: "/all" }]} />)
    expect(screen.getByRole("navigation", { name: "Vistas" }).tagName).toBe("NAV")
    expect(screen.getByRole("link", { name: "Todas" })).toHaveAttribute("aria-current", "page")
  })
})

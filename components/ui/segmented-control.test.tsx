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
  it("con enlaces también es un grupo, sin crear un landmark de navegación, y marca la página actual", () => {
    render(<SegmentedControl ariaLabel="Vistas" items={[{ key: "all", label: "Todas", active: true, href: "/all" }]} />)
    expect(screen.getByRole("group", { name: "Vistas" }).tagName).toBe("DIV")
    expect(screen.queryByRole("navigation")).toBeNull()
    expect(screen.getByRole("link", { name: "Todas" })).toHaveAttribute("aria-current", "page")
  })
})

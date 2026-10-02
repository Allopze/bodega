// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Button } from "@/components/ui/button"
import { WorkspaceLink } from "./workspace-nav"

const HREF = "/prevencion/miper/m1?tarea=k"

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ""
})

describe("WorkspaceLink", () => {
  it("un clic normal usa pushState y previene la navegación", () => {
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    render(<WorkspaceLink href={HREF}>Carga</WorkspaceLink>)
    expect(fireEvent.click(screen.getByRole("link", { name: "Carga" }))).toBe(false)
    expect(push).toHaveBeenCalledWith(null, "", HREF)
  })

  it("ctrl+clic y clic medio no navegan por historial", () => {
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    render(<WorkspaceLink href={HREF}>Carga</WorkspaceLink>)
    const link = screen.getByRole("link", { name: "Carga" })
    link.addEventListener("click", (event) => event.preventDefault())
    fireEvent.click(link, { ctrlKey: true })
    fireEvent.click(link, { button: 1 })
    expect(push).not.toHaveBeenCalled()
  })

  it("con replace usa replaceState", () => {
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
    render(<WorkspaceLink href={HREF} replace>Carga</WorkspaceLink>)
    fireEvent.click(screen.getByRole("link", { name: "Carga" }))
    expect(replace).toHaveBeenCalledWith(null, "", HREF)
    expect(push).not.toHaveBeenCalled()
  })

  it("al hacer push sube el pozo del shell al inicio", () => {
    vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    const scrollTo = vi.fn()
    well.scrollTo = scrollTo
    document.body.appendChild(well)
    render(<WorkspaceLink href={HREF}>Carga</WorkspaceLink>)
    fireEvent.click(screen.getByRole("link", { name: "Carga" }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
  })

  it("funciona dentro de Button asChild como un único <a>", () => {
    const { container } = render(<Button asChild><WorkspaceLink href={HREF}>Ir</WorkspaceLink></Button>)
    expect(container.querySelectorAll("a")).toHaveLength(1)
    expect(container.querySelector("button")).toBeNull()
    expect(container.querySelector("a")!.className.length).toBeGreaterThan(0)
  })
})

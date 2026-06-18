// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Badge } from "@/components/ui/badge"

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>Pendiente</Badge>)
    expect(screen.getByText("Pendiente")).toBeDefined()
  })

  it("renders dot indicator when dot=true", () => {
    const { container } = render(<Badge dot>Alerta</Badge>)
    // The dot is a span with aria-hidden
    const dot = container.querySelector("[aria-hidden]")
    expect(dot).toBeDefined()
  })

  it("applies variant class", () => {
    const { container } = render(<Badge variant="success">OK</Badge>)
    const el = container.firstChild as HTMLElement
    expect(el.className).toMatch(/success/)
  })

  it("applies extra className", () => {
    const { container } = render(<Badge className="my-custom">X</Badge>)
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain("my-custom")
  })

  it("spreads HTML span props", () => {
    render(<Badge data-testid="b">Test</Badge>)
    expect(screen.getByTestId("b")).toBeDefined()
  })
})

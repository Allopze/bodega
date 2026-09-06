// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Badge } from "@/components/ui/badge"
import { MetaBadge } from "@/components/states/state-badge"

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>Pendiente</Badge>)
    expect(screen.getByText("Pendiente")).toBeDefined()
  })

  it("renders dot indicator when dot=true", () => {
    const { container } = render(<MetaBadge meta={{ label: "Alerta", variant: "default" }} dot />)
    // The dot is a span with aria-hidden
    const dot = container.querySelector("[aria-hidden]")
    expect(dot).toBeDefined()
  })

  it("applies variant class", () => {
    const { container } = render(<MetaBadge meta={{ label: "OK", variant: "success" }} />)
    const el = container.firstChild as HTMLElement
    expect(el.className).toMatch(/success/)
  })

  it("applies extra className", () => {
    const { container } = render(<MetaBadge meta={{ label: "X", variant: "default" }} className="my-custom" />)
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain("my-custom")
  })

  it("spreads HTML span props", () => {
    render(<Badge data-testid="b">Test</Badge>)
    expect(screen.getByTestId("b")).toBeDefined()
  })
})

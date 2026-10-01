// @vitest-environment jsdom
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RiskClassificationBadge } from "./risk-classification-badge"

describe("RiskClassificationBadge", () => {
  it("siempre muestra el nombre, no sólo el color", () => {
    const { getByText } = render(<RiskClassificationBadge classification="intolerable" magnitude={16} />)
    expect(getByText(/Intolerable/)).toBeTruthy()
    expect(getByText(/16/)).toBeTruthy()
  })
  it("Intolerable es relleno sólido; los demás, tinte con texto -ink", () => {
    const solid = render(<RiskClassificationBadge classification="intolerable" />).container.firstElementChild!
    expect(solid.className).toContain("bg-[var(--color-danger)]")
    const tint = render(<RiskClassificationBadge classification="moderate" />).container.firstElementChild!
    expect(tint.className).toContain("text-[var(--color-warning-ink)]")
  })
  it("sin P o C dice 'Sin evaluar'", () => {
    expect(render(<RiskClassificationBadge classification={null} />).getByText("Sin evaluar")).toBeTruthy()
  })
})

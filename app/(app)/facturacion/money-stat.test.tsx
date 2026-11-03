// @vitest-environment jsdom

/**
 * CHART-036: `MoneyStat` admite una variación contra el mes anterior, una por
 * moneda. Sin `comparison` el tile queda exactamente como estaba (lo usa también
 * Finanzas del tablero).
 */
import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { MoneyStat } from "./money-stat"

const base = {
  label: "Facturado en el período",
  detail: "3 documentos emitidos",
  origin: "Documentos sincronizados",
} as const

describe("MoneyStat · variación contra el mes anterior", () => {
  it("sin `comparison` no dibuja ninguna variación", () => {
    const { container } = render(<MoneyStat {...base} amounts={[{ currency: "CLP", amount: 1_500_000 }]} />)
    expect(container.querySelector("[data-delta]")).toBeNull()
  })

  it("dibuja la variación de la moneda junto a su cifra, con el mes de comparación", () => {
    const { container, getByText } = render(
      <MoneyStat
        {...base}
        amounts={[{ currency: "CLP", amount: 1_500_000 }]}
        comparison={{ label: "vs. sep", changes: { CLP: 50 } }}
      />,
    )
    const delta = container.querySelector("[data-delta]")
    expect(delta).not.toBeNull()
    expect(delta!.textContent).toContain("50%")
    expect(delta!.textContent).toContain("vs. sep")
    expect(delta!.textContent).toContain("Sube 50%")
    // El tile sigue siendo uno solo.
    expect(container.querySelectorAll("[data-kpi-card]")).toHaveLength(1)
    expect(getByText("$1.500.000")).toBeDefined()
  })

  it("una variación por moneda: la de una no se pega a la otra", () => {
    const { container } = render(
      <MoneyStat
        {...base}
        amounts={[{ currency: "CLP", amount: 1_000 }, { currency: "USD", amount: 20 }]}
        comparison={{ label: "vs. sep", changes: { CLP: -10, USD: null } }}
      />,
    )
    const deltas = container.querySelectorAll("[data-delta]")
    // USD no tiene mes anterior comparable: no se inventa una variación.
    expect(deltas).toHaveLength(1)
    expect(deltas[0]!.textContent).toContain("Baja 10%")
  })

  it("la polaridad por defecto es «sube = bien»; `neutral` no pinta de verde ni de rojo", () => {
    const { container } = render(
      <MoneyStat {...base} amounts={[{ currency: "CLP", amount: 1_000 }]} comparison={{ label: "vs. sep", polarity: "neutral", changes: { CLP: 20 } }} />,
    )
    expect(container.querySelector("[data-delta]")!.getAttribute("data-delta")).toBe("neutral")
    const good = render(<MoneyStat {...base} amounts={[{ currency: "CLP", amount: 1_000 }]} comparison={{ label: "vs. sep", changes: { CLP: 20 } }} />)
    expect(good.container.querySelector("[data-delta]")!.getAttribute("data-delta")).toBe("positive")
  })

  it("sin cifras no hay variación que mostrar", () => {
    const { container } = render(<MoneyStat {...base} amounts={[]} comparison={{ label: "vs. sep", changes: { CLP: 20 } }} />)
    expect(container.querySelector("[data-delta]")).toBeNull()
  })
})

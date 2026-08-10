// @vitest-environment jsdom

/**
 * I-09: con 1-2 datos, las tarjetas de ranking y composición degradan a una
 * lectura compacta en vez de un plot casi vacío; con 3+ mantienen el gráfico.
 */
import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { CompositionDonutChart, ThresholdRankingChart } from "./dashboard-charts"

const bars = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ name: `Item ${index + 1}`, value: 10 + index, detail: `${index} de 10` }))

describe("ThresholdRankingChart (I-09)", () => {
  it("con ≤2 filas rinde el medidor compacto, sin plot recharts", () => {
    const { container, getByText } = render(
      <ThresholdRankingChart title="Cobertura" description="d" data={bars(2)} />,
    )
    // Una sola vez cada uno: antes aparecían dos porque la tabla equivalente
    // los repetía bajo el medidor, y el `>= 2` afirmaba esa duplicación.
    // `getByText` es más estricto que el conteo: falla también si hay dos.
    expect(getByText("Item 1")).toBeDefined()
    expect(getByText("0 de 10")).toBeDefined()
    expect(container.querySelector("[data-chart]")).toBeNull()
  })

  it("con 3+ filas mantiene el gráfico", () => {
    const { container } = render(
      <ThresholdRankingChart title="Cobertura" description="d" data={bars(3)} />,
    )
    expect(container.querySelector("[data-chart]")).not.toBeNull()
  })
})

describe("CompositionDonutChart (I-09)", () => {
  const slice = (key: string, value: number) => ({ key, label: key, value })

  it("con ≤2 porciones rinde la barra de composición, sin dona", () => {
    const { container, getByText } = render(
      <CompositionDonutChart title="Gasto" description="d" totalLabel="del período" data={[slice("EPP", 80), slice("Combustible", 20)]} />,
    )
    expect(getByText(/EPP/)).toBeDefined()
    expect(container.querySelector("[data-chart]")).toBeNull()
  })

  it("con 3+ porciones mantiene la dona", () => {
    const { container } = render(
      <CompositionDonutChart title="Gasto" description="d" totalLabel="del período" data={[slice("A", 50), slice("B", 30), slice("C", 20)]} />,
    )
    expect(container.querySelector("[data-chart]")).not.toBeNull()
  })
})

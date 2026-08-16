// @vitest-environment jsdom

/**
 * I-09: con 1-2 datos, las tarjetas de ranking y composición degradan a una
 * lectura compacta en vez de un plot casi vacío; con 3+ mantienen el gráfico.
 */
import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import {
  CompositionDonutChart,
  ModuleWorkloadChart,
  ThresholdRankingChart,
  WorksiteActivityChart,
} from "./dashboard-charts"

const bars = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ name: `Item ${index + 1}`, value: 10 + index, detail: `${index} de 10` }))

describe("ThresholdRankingChart (I-09)", () => {
  it("con ≤2 filas rinde el medidor compacto, sin plot recharts", () => {
    const { container, getByText } = render(
      <ThresholdRankingChart title="Cobertura" description="d" data={bars(2)} />,
    )
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

describe("WorksiteActivityChart", () => {
  it("renderiza el gráfico de inversión por faena con datos", () => {
    const { container, getByText } = render(
      <WorksiteActivityChart
        worksites={[
          { name: "Faena Central", totalCost: 1500000 },
          { name: "Faena Norte", totalCost: 800000 },
          { name: "Faena Sur", totalCost: 300000 },
        ]}
      />,
    )
    expect(getByText("Inversión por Faena")).toBeDefined()
    expect(container.querySelector("[data-chart]")).not.toBeNull()
  })

  it("retorna null si no hay costos registrados", () => {
    const { container } = render(
      <WorksiteActivityChart
        worksites={[
          { name: "Faena Central", totalCost: 0 },
        ]}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})

describe("ModuleWorkloadChart", () => {
  it("renderiza la distribución por módulo con datos", () => {
    const { container, getByText } = render(
      <ModuleWorkloadChart
        data={[
          { module: "Compras", count: 12 },
          { module: "Bodega", count: 8 },
          { module: "Recepción", count: 5 },
        ]}
        total={25}
      />,
    )
    expect(getByText("Distribución por Módulo")).toBeDefined()
    expect(getByText("25 tareas")).toBeDefined()
    expect(container.querySelector("[data-chart]")).not.toBeNull()
  })
})

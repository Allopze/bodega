// @vitest-environment jsdom
/**
 * Los dos gráficos de `/analitica` (CHART-033). jsdom no mide, así que acá se comprueba lo que el
 * componente decide —qué leyenda lleva, qué capas dibuja, cómo se nombra— y que no revienta con los
 * estados borde (mes sin datos del proveedor, mes parcial, sin permiso de costos); la forma de los
 * datos y las frases tienen sus pruebas puras en `analytics-trend.test.ts` y `analytics-pareto.test.ts`.
 */
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { SpendByMonthRow } from "@/lib/services/analytics"
import { buildSupplierPareto } from "./analytics-pareto"
import { MonthlySpendChart, SupplierParetoChart } from "./analytics-charts"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

/** Un hex como valor de `fill`, `stroke` o `background`. (El `#ccc` de las clases utilitarias de `ChartContainer` es un selector, no un color pintado.) */
const HEX_COLOR_ATTRIBUTE = /(fill|stroke|background(-color)?)(=|:\s*)"?#[0-9a-fA-F]{3,8}/

const months: SpendByMonthRow[] = [
  { month: "2026-07", purchasingAmount: 100, fuelAmount: 50, totalAmount: 150, partial: false },
  { month: "2026-08", purchasingAmount: 70, fuelAmount: null, totalAmount: 70, partial: false },
  { month: "2026-09", purchasingAmount: 20, fuelAmount: 0, totalAmount: 20, partial: true },
]

describe("MonthlySpendChart", () => {
  it("nombra cada capa en la leyenda, el hueco del proveedor y el mes parcial: el color no es el único portador", () => {
    const { container } = render(<MonthlySpendChart data={months} showFuel />)

    const text = container.textContent ?? ""
    expect(text).toContain("Compras")
    expect(text).toContain("Combustible")
    expect(text).toContain("Mes sin datos del proveedor de combustible")
    expect(text).toContain("* Mes parcial")
    // Sin una serie «Total»: es la suma de las dos capas y repetía la cifra.
    expect(text).not.toContain("Total")
  })

  it("sin permiso de costos de combustible no existe la capa ni su leyenda", () => {
    const { container } = render(<MonthlySpendChart data={months} showFuel={false} />)

    expect(container.textContent).not.toContain("Combustible")
    expect(container.textContent).toContain("Compras")
  })

  it("sin huecos ni meses parciales la leyenda no inventa avisos", () => {
    const { container } = render(<MonthlySpendChart data={[months[0]!]} showFuel />)

    expect(container.textContent).not.toContain("sin datos del proveedor")
    expect(container.textContent).not.toContain("Mes parcial")
  })

  it("sin barra «Otros» (todos los proveedores listados) la leyenda no la nombra", () => {
    const completo = buildSupplierPareto({
      suppliers: [{ id: "s-1", name: "Copec", module: "Combustible", totalAmount: 1000, count: 30 }],
      totalSpend: 1000,
    })
    const { container } = render(<SupplierParetoChart rows={completo.rows} thresholdPct={60} />)
    expect(container.textContent ?? "").not.toContain("Otros proveedores")
  })

  it("no usa ningún color fuera de los tokens", () => {
    const { container } = render(<MonthlySpendChart data={months} showFuel />)

    expect(container.innerHTML).not.toMatch(HEX_COLOR_ATTRIBUTE)
  })
})

describe("SupplierParetoChart", () => {
  const pareto = buildSupplierPareto({
    suppliers: [
      { id: "s-1", name: "Ferretería Sur", module: "Compras", totalAmount: 700, count: 4 },
      { id: "s-2", name: "Copec", module: "Combustible", totalAmount: 200, count: 30 },
    ],
    totalSpend: 1000,
  })

  it("explica los dos ejes y marca «Otros proveedores» como lo que no es un proveedor", () => {
    const { container } = render(<SupplierParetoChart rows={pareto.rows} thresholdPct={60} />)

    const text = container.textContent ?? ""
    expect(text).toContain("Gasto por proveedor (eje izquierdo)")
    expect(text).toContain("% acumulado del gasto total (eje derecho)")
    expect(text).toContain("Otros proveedores")
  })

  it("no usa ningún color fuera de los tokens", () => {
    const { container } = render(<SupplierParetoChart rows={pareto.rows} thresholdPct={60} />)

    expect(container.innerHTML).not.toMatch(HEX_COLOR_ATTRIBUTE)
  })
})

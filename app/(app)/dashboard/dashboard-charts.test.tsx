// @vitest-environment jsdom

/**
 * I-09: con 1-2 datos, las tarjetas de composición degradan a una lectura
 * compacta en vez de un plot casi vacío; con 3+ mantienen el gráfico. Los
 * rankings ya no son gráficos: viven en `RankedList` (components/ui), con sus
 * propios tests.
 */
import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import {
  BillingFlowChart,
  CompositionDonutChart,
  FuelConsumptionChart,
  MaintenanceTrendChart,
  MaterialEnvironmentalChart,
  OperationalTrendChart,
  SstAccidentChart,
  SstTrendChart,
  StatusShareBar,
  billingPeriodLabel,
} from "./dashboard-charts"

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

describe("OperationalTrendChart", () => {
  const months = ["May", "Jun", "Jul", "Ago", "Sep", "Oct"]
  const series = (requests: number[], orders: number[], receipts: number[]) =>
    months.map((month, index) => ({ month, requests: requests[index] ?? 0, orders: orders[index] ?? 0, receipts: receipts[index] ?? 0 }))
  const sample = series([0, 0, 14, 14, 8, 3], [0, 0, 12, 11, 3, 0], [0, 0, 5, 35, 2, 2])

  it("la cifra grande es la del último mes, con su nombre y la variación contra el anterior", () => {
    const { container } = render(<OperationalTrendChart data={sample} />)
    expect(screen.getByText("Tendencia Operativa")).toBeDefined()
    // La misma cifra aparece también en la leyenda (valores del mes activo):
    // la cabecera es la `ChartHeadlineValue`, la de 28 px.
    expect(container.querySelector(".text-\\[28px\\]")?.textContent).toBe("3")
    expect(screen.getByText("solicitudes en octubre")).toBeDefined()
    // 3 solicitudes en octubre contra 8 en septiembre.
    expect(screen.getByText("Baja 5 vs. sep")).toBeDefined()
    expect(container.querySelector("[data-chart]")).not.toBeNull()
  })

  it("la leyenda trae las tres series con los valores del último mes", () => {
    render(<OperationalTrendChart data={sample} />)
    const names = screen.getAllByRole("button").map((button) => button.textContent)
    expect(names).toEqual(["Solicitudes3", "OC emitidas0", "Recepciones2"])
  })

  it("enfocar una serie en la leyenda atenúa a las demás; el clic la fija", () => {
    render(<OperationalTrendChart data={sample} />)
    const solicitudes = screen.getByRole("button", { name: /Solicitudes/ })
    const ordenes = screen.getByRole("button", { name: /OC emitidas/ })
    expect(ordenes.className).not.toContain("opacity-45")

    fireEvent.pointerEnter(solicitudes)
    expect(ordenes.className).toContain("opacity-45")
    expect(solicitudes.className).not.toContain("opacity-45")
    fireEvent.pointerLeave(solicitudes)
    expect(ordenes.className).not.toContain("opacity-45")

    fireEvent.click(solicitudes)
    expect(solicitudes.getAttribute("aria-pressed")).toBe("true")
    expect(ordenes.className).toContain("opacity-45")
    fireEvent.click(solicitudes)
    expect(solicitudes.getAttribute("aria-pressed")).toBe("false")
  })

  it("si el rol no ve solicitudes (todas en 0) la cifra grande pasa a la primera serie con datos", () => {
    render(<OperationalTrendChart data={series([], [0, 0, 12, 11, 3, 4], [0, 0, 5, 35, 2, 2])} />)
    expect(screen.getByText("OC emitidas en octubre")).toBeDefined()
    expect(screen.queryByText(/solicitudes en/)).toBeNull()
  })

  it("retorna null si todo está en cero", () => {
    const { container } = render(<OperationalTrendChart data={series([], [], [])} />)
    expect(container.firstChild).toBeNull()
  })
})

describe("BillingFlowChart", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      period: `2026-${String(index + 1).padStart(2, "0")}`,
      invoiced: 1_000_000 * (index + 1),
      collected: 500_000 * (index + 1),
    }))

  it("billingPeriodLabel rotula el período en español", () => {
    expect(billingPeriodLabel("2026-07")).toBe("Jul 2026")
    expect(billingPeriodLabel("sin-formato")).toBe("sin-formato")
  })

  it("con ≤6 períodos dibuja columnas pareadas", () => {
    const { container } = render(<BillingFlowChart data={rows(2)} />)
    expect(container.querySelector('[data-chart-kind="bars"]')).not.toBeNull()
    expect(container.querySelector('[data-chart-kind="lines"]')).toBeNull()
  })

  it("con >6 períodos dibuja líneas", () => {
    const { container } = render(<BillingFlowChart data={rows(7)} />)
    expect(container.querySelector('[data-chart-kind="lines"]')).not.toBeNull()
    expect(container.querySelector('[data-chart-kind="bars"]')).toBeNull()
  })

  it("la cabecera resume la ventana completa: cobrado de facturado y entre qué meses", () => {
    render(
      <BillingFlowChart
        data={[
          { period: "2026-07", invoiced: 1_400_000_000, collected: 0 },
          { period: "2026-08", invoiced: 1_060_000_000, collected: 0 },
        ]}
      />,
    )
    expect(screen.getByText("Facturado y cobrado")).toBeDefined()
    expect(screen.getByText("$0")).toBeDefined()
    expect(screen.getByText("cobrado de $2.460M facturado entre julio y agosto")).toBeDefined()
  })

  it("si la ventana cruza de año el rótulo lleva el año", () => {
    render(
      <BillingFlowChart
        data={[
          { period: "2025-12", invoiced: 100, collected: 50 },
          { period: "2026-01", invoiced: 100, collected: 50 },
        ]}
      />,
    )
    expect(screen.getByText(/entre diciembre de 2025 y enero de 2026/)).toBeDefined()
  })

  it("retorna null si no hay facturado ni cobrado", () => {
    const { container } = render(<BillingFlowChart data={[{ period: "2026-03", invoiced: 0, collected: 0 }]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe("gráficos SST y de flota", () => {
  const sst = (value: number) =>
    ["Ene", "Feb", "Mar"].map((month) => ({ month, tasaFrecuencia: value, tasaGravedad: value, confirmados: value, porCalificar: 0 }))

  it("rinden su gráfico con datos y su cifra/leyenda", () => {
    const accident = render(<SstAccidentChart data={sst(2)} />)
    expect(accident.container.querySelector("[data-chart]")).not.toBeNull()
    // 3 meses × 2 accidentes.
    expect(screen.getByText("6")).toBeDefined()
    expect(screen.getByText("accidentes en el período")).toBeDefined()
    accident.unmount()

    const rates = render(<SstTrendChart data={sst(1)} />)
    expect(rates.container.querySelector("[data-chart]")).not.toBeNull()
    expect(screen.getByRole("button", { name: /Tasa de Frecuencia/ })).toBeDefined()
    rates.unmount()

    const material = render(
      <MaterialEnvironmentalChart data={[{ month: "Ene", dangerousIncidents: 1, materialDamage: 0, environmentalSpills: 0 }]} />,
    )
    expect(material.container.querySelector("[data-chart]")).not.toBeNull()
  })

  it("devuelven null sin datos (I-03)", () => {
    expect(render(<SstAccidentChart data={sst(0)} />).container.firstChild).toBeNull()
    expect(render(<SstTrendChart data={sst(0)} />).container.firstChild).toBeNull()
    expect(
      render(<MaterialEnvironmentalChart data={[{ month: "Ene", dangerousIncidents: 0, materialDamage: 0, environmentalSpills: 0 }]} />).container.firstChild,
    ).toBeNull()
  })

  it("combustible: cifra grande = litros del período; sin costos no hay serie de costo", () => {
    const data = [
      { month: "Sep", liters: 1000, amount: 900_000, loads: 4 },
      { month: "Oct", liters: 2500, amount: null, loads: 6 },
    ]
    const withCosts = render(<FuelConsumptionChart data={data} periodLabel="últimos 6 meses" />)
    expect(screen.getByText("3.500")).toBeDefined()
    expect(screen.getByText("litros cargados en el período")).toBeDefined()
    expect(screen.getByRole("button", { name: /Costo/ })).toBeDefined()
    withCosts.unmount()

    render(<FuelConsumptionChart data={data} showCosts={false} />)
    expect(screen.queryByRole("button", { name: /Costo/ })).toBeNull()
  })

  it("mantención: cifra grande = completadas del período", () => {
    render(<MaintenanceTrendChart data={[
      { month: "Sep", completed: 3, scheduled: 5, amount: 100_000 },
      { month: "Oct", completed: 4, scheduled: 2, amount: null },
    ]} />)
    expect(screen.getByText("7")).toBeDefined()
    expect(screen.getByText("mantenciones completadas en el período")).toBeDefined()
  })

  it("combustible y mantención devuelven null sin datos", () => {
    expect(render(<FuelConsumptionChart data={[{ month: "Ene", liters: 0, amount: 0, loads: 0 }]} />).container.firstChild).toBeNull()
    expect(render(<MaintenanceTrendChart data={[]} />).container.firstChild).toBeNull()
  })
})

describe("StatusShareBar", () => {
  it("rinde la barra con su leyenda, sin superficie propia", () => {
    const { container, getByText } = render(
      <StatusShareBar title="Estados" description="d" data={[{ key: "a", label: "Al día", value: 3 }, { key: "b", label: "Vencidos", value: 1 }]} />,
    )
    expect(getByText("Estados")).toBeDefined()
    expect(getByText("Al día")).toBeDefined()
    // La superficie (borde, fondo, sombra) la pone el ChartSlot del panel.
    expect(container.querySelector(".shadow-xs")).toBeNull()
    expect(container.querySelector(".border")).toBeNull()
  })

  it("retorna null si todo está en cero", () => {
    const { container } = render(<StatusShareBar title="Estados" description="d" data={[{ key: "a", label: "Al día", value: 0 }]} />)
    expect(container.firstChild).toBeNull()
  })
})

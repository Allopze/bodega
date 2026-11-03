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
  MaterialEnvironmentalChart,
  OperationalTrendChart,
  SstAccidentChart,
  SstTrendChart,
  StatusShareBar,
  billingPeriodLabel,
} from "./dashboard-charts"
import { dimmedBarShape, partialTailLineShape } from "./charts/chart-parts"
import { fuelHeadlineCaption, fuelTooltipTitle } from "./charts/fleet-charts"

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

  it("combustible: un mes sin datos del proveedor se nombra y no suma ni se lee como cero (C-4)", () => {
    const data = [
      { month: "Ago", liters: 1000, amount: 900_000, loads: 4, providerGap: false },
      { month: "Sep", liters: null, amount: null, loads: null, providerGap: true },
      { month: "Oct", liters: 2500, amount: 1_100_000, loads: 6, providerGap: false },
    ]
    render(<FuelConsumptionChart data={data} periodLabel="últimos 6 meses" />)

    // La cifra grande sólo suma los meses con datos.
    expect(screen.getByText("3.500")).toBeDefined()
    // El hueco se dice en la descripción del gráfico: sin explicación se lee como un error de la línea.
    expect(screen.getByText(/sin datos del proveedor en septiembre/)).toBeDefined()
  })

  it("combustible: dos meses sin datos se unen con «y»", () => {
    const data = [
      { month: "Jul", liters: 100, amount: 10, loads: 1, providerGap: false },
      { month: "Ago", liters: null, amount: null, loads: null, providerGap: true },
      { month: "Sep", liters: null, amount: null, loads: null, providerGap: true },
    ]
    render(<FuelConsumptionChart data={data} />)

    expect(screen.getByText(/sin datos del proveedor en agosto y septiembre/)).toBeDefined()
  })

  it("combustible sin huecos no agrega ningún aviso", () => {
    render(<FuelConsumptionChart data={[{ month: "Ago", liters: 1000, amount: 900_000, loads: 4, providerGap: false }]} />)

    expect(screen.queryByText(/sin datos del proveedor/)).toBeNull()
  })

  // El mes en curso vale sólo los días transcurridos: sin aviso, su barra casi vacía se lee como un colapso del consumo.
  it("combustible: el mes en curso se dice parcial en la descripción, igual que Analítica", () => {
    const data = [
      { month: "Sep", liters: 1000, amount: 900_000, loads: 4, providerGap: false, partial: false },
      { month: "Oct", liters: 2500, amount: 1_100_000, loads: 6, providerGap: false, partial: false },
      { month: "Nov", liters: 90, amount: 40_000, loads: 1, providerGap: false, partial: true },
    ]
    render(<FuelConsumptionChart data={data} periodLabel="últimos 6 meses" />)

    expect(screen.getByText(/Litros cargados y costo por mes · últimos 6 meses · el último mes es parcial/)).toBeDefined()
  })

  it("combustible: el aviso de mes parcial convive con el de un mes sin datos del proveedor", () => {
    const data = [
      { month: "Oct", liters: 2500, amount: 1_100_000, loads: 6, providerGap: false, partial: false },
      { month: "Nov", liters: null, amount: null, loads: null, providerGap: true, partial: true },
    ]
    render(<FuelConsumptionChart data={data} />)

    expect(screen.getByText(/el último mes es parcial · sin datos del proveedor en noviembre/)).toBeDefined()
  })

  it("combustible sin mes parcial no agrega el aviso", () => {
    render(<FuelConsumptionChart data={[{ month: "Oct", liters: 2500, amount: 1_100_000, loads: 6, providerGap: false, partial: false }]} />)

    expect(screen.queryByText(/parcial/)).toBeNull()
  })

  it("combustible: el tooltip y la cifra grande rotulan «(parcial)» sólo en el mes parcial", () => {
    const data = [
      { month: "Oct", liters: 2500, amount: 1_100_000, loads: 6, providerGap: false, partial: false },
      { month: "Nov", liters: 90, amount: 40_000, loads: 1, providerGap: false, partial: true },
    ]

    expect(fuelTooltipTitle("Nov", data)).toBe("Noviembre (parcial)")
    expect(fuelTooltipTitle("Oct", data)).toBe("Octubre")
    expect(fuelHeadlineCaption(data[1])).toBe("litros cargados en noviembre (parcial)")
    expect(fuelHeadlineCaption(data[0])).toBe("litros cargados en octubre")
    expect(fuelHeadlineCaption(undefined)).toBe("litros cargados en el período")
    expect(fuelHeadlineCaption({ month: "Nov", liters: null, amount: null, loads: null, providerGap: true, partial: true })).toBe("sin datos del proveedor en noviembre")
  })

  it("combustible devuelve null sin datos", () => {
    expect(render(<FuelConsumptionChart data={[{ month: "Ene", liters: 0, amount: 0, loads: 0 }]} />).container.firstChild).toBeNull()
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

/**
 * Los gráficos de series por mes dibujan el mes parcial distinto de los completos
 * (columna tenue con contorno punteado; último tramo de la línea punteado). recharts
 * no monta nada en jsdom (sin tamaño), así que se comprueban las formas que le
 * entregamos al `shape` de `<Bar>` y de `<Line>`.
 */
describe("mes parcial en las series del tablero", () => {
  const bar = (shape: ReturnType<typeof dimmedBarShape>, index: number) =>
    render(<svg>{shape({ index, x: 10, y: 10, width: 20, height: 40, fill: "#0a0" } as never)}</svg>).container.querySelector("path")!

  it("la columna parcial va tenue y con contorno punteado; las completas, llenas", () => {
    const shape = dimmedBarShape("liters", null, null, 5)

    const complete = bar(shape, 4)
    expect(complete.getAttribute("stroke-dasharray")).toBeNull()
    expect(complete.getAttribute("fill-opacity")).toBeNull()

    const partial = bar(shape, 5)
    expect(partial.getAttribute("stroke-dasharray")).toBeTruthy()
    expect(partial.getAttribute("stroke")).toBe("#0a0")
    expect(Number(partial.getAttribute("fill-opacity"))).toBeLessThan(0.6)
  })

  // En producción septiembre no tiene datos del proveedor: recharts no dibuja su columna y `index` se corre un lugar.
  it("con un mes sin columna antes, el mes parcial se reconoce por el índice de los datos y no por el de las columnas dibujadas", () => {
    const shape = dimmedBarShape("liters", null, null, 5)
    const column = (index: number, originalDataIndex: number) =>
      render(<svg>{shape({ index, originalDataIndex, x: 10, y: 10, width: 20, height: 40, fill: "#0a0" } as never)}</svg>).container.querySelector("path")!

    // Octubre es la 4.ª columna dibujada (índice 3) pero el 5.º mes (índice de datos 4); noviembre, la 5.ª (4) y el 6.º mes (5).
    expect(column(3, 4).getAttribute("stroke-dasharray")).toBeNull()
    expect(column(4, 5).getAttribute("stroke-dasharray")).toBeTruthy()
  })

  it("la columna apuntada se reconoce por el índice de los datos, igual que en el tooltip", () => {
    const shape = dimmedBarShape("liters", 4, null)
    const opacity = (index: number, originalDataIndex: number) =>
      Number(render(<svg>{shape({ index, originalDataIndex, x: 10, y: 10, width: 20, height: 40, fill: "#0a0" } as never)}</svg>).container.querySelector("path")!.getAttribute("opacity"))

    expect(opacity(3, 4)).toBe(1)
    expect(opacity(4, 5)).toBeLessThan(1)
  })

  it("sin mes parcial ninguna columna cambia", () => {
    expect(bar(dimmedBarShape("liters", null, null), 5).getAttribute("stroke-dasharray")).toBeNull()
  })

  it("la línea es sólida hasta el último mes completo y su último tramo, punteado", () => {
    const points = [{ x: 0, y: 40 }, { x: 40, y: 30 }, { x: 80, y: 35 }, { x: 120, y: 120 }]
    const shape = partialTailLineShape(3)
    const { container } = render(<svg>{shape({ points, type: "linear", stroke: "#00f", className: "recharts-line-curve", pathRef: { current: null } } as never)}</svg>)

    const paths = Array.from(container.querySelectorAll("path.recharts-line-curve"))
    expect(paths).toHaveLength(2)
    expect(paths[0]!.getAttribute("stroke-dasharray")).toBeNull()
    expect(paths[0]!.getAttribute("d")).toBe("M0,40L40,30L80,35")
    // El tramo punteado arranca en el último punto completo: la línea no se corta.
    expect(paths[1]!.getAttribute("stroke-dasharray")).toBeTruthy()
    expect(paths[1]!.getAttribute("d")).toBe("M80,35L120,120")
  })

  it("sin mes parcial la línea se dibuja entera y sólida", () => {
    const points = [{ x: 0, y: 40 }, { x: 40, y: 30 }, { x: 80, y: 35 }]
    const { container } = render(<svg>{partialTailLineShape(-1)({ points, type: "linear", stroke: "#00f", className: "recharts-line-curve", pathRef: { current: null } } as never)}</svg>)

    const paths = Array.from(container.querySelectorAll("path.recharts-line-curve"))
    expect(paths).toHaveLength(1)
    expect(paths[0]!.getAttribute("stroke-dasharray")).toBeNull()
    expect(paths[0]!.getAttribute("d")).toBe("M0,40L40,30L80,35")
  })
})

// @vitest-environment jsdom

/**
 * Los gráficos densos que usan `<DenseChart>` (regla «Responsive» de DESIGN.md §
 * Gráficos): con la pantalla ancha dibujan el gráfico y con una de menos de 360 px
 * lo reemplazan por su ranking (`RankedList`). `components/__tests__/chart-guard.test.ts`
 * obliga a que existan; éste comprueba que el reemplazo dice lo mismo.
 *
 * jsdom no calcula media queries: se responde `matchMedia` a mano. Con la pantalla
 * angosta recharts ni se monta, así que no hace falta simular el contenedor.
 */
import type { ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { NARROW_CHART_QUERY } from "@/components/charts/dense-chart"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

import { buildLphComparison } from "@/lib/combustibles/control/calc/lph-comparison"
import { LphScatterChart } from "@/app/(app)/combustibles/control/_charts/lph-scatter-chart"
import { OverviewRankingChart } from "@/app/(app)/combustibles/control/_charts/overview-ranking-chart"
import { OverviewMonthlyChart } from "@/app/(app)/combustibles/control/_charts/overview-monthly-chart"
import type { MonthlyMediumChartData } from "@/lib/combustibles/control/view-helpers"
import { EvolutionByVehicleChart } from "@/app/(app)/combustibles/evolution-by-vehicle-chart"
import { LitersVsKmChart } from "@/app/(app)/combustibles/scatter-charts"
import { PatenteRankingChart, RendimientoChart } from "@/app/(app)/combustibles/consumption-charts"
import { SupplierParetoChart } from "@/app/(app)/analitica/analytics-charts"

const original = window.matchMedia

/** `narrow`: la pantalla mide menos de 360 px. Las demás consultas (movimiento reducido…) no coinciden. */
function viewport(narrow: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: narrow && query === NARROW_CHART_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

afterEach(() => {
  cleanup()
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: original })
})

const LPH = buildLphComparison([
  { vehicleId: "a", equipment: "KA-1 · PL-A", month: "2026-03", telemetryLph: 10.5, loadsLph: 10, loadCount: 2, differencePct: null },
  { vehicleId: "c", equipment: "KC-3 · PL-C", month: "2026-03", telemetryLph: 18, loadsLph: 10, loadCount: 2, differencePct: null },
])

const PANELS = {
  panels: [
    { plate: "AA0001", label: "KA-1 · AA0001", vehicleId: "v1", total: 300, series: [{ periodo: "2026-01-01", liters: 100 }, { periodo: "2026-02-01", liters: 200 }] },
    { plate: "BB0002", label: "BB0002", vehicleId: null, total: 120, series: [{ periodo: "2026-01-01", liters: 120 }, { periodo: "2026-02-01", liters: null }] },
  ],
  periods: ["2026-01-01", "2026-02-01"],
  axisMax: 300,
  totalEquipment: 2,
  hiddenCount: 0,
  shownLiters: 420,
  allLiters: 420,
}

const PARETO = [
  { key: "p1", label: "Proveedor Uno", module: "Compras", amount: 6_000_000, count: 4, sharePct: 60, cumulativePct: 60, isOther: false, href: "/compras?proveedor=p1" },
  { key: "otros", label: "Otros proveedores", module: null, amount: 4_000_000, count: 9, sharePct: 40, cumulativePct: 100, isOther: true },
]

/** Una columna apilada con `count` medios de suministro de 100 L cada uno, en un solo mes. */
function stacked(count: number): MonthlyMediumChartData {
  const series = Array.from({ length: count }, (_, index) => ({ key: `m${index}`, label: `Medio ${index + 1}` }))
  const point: MonthlyMediumChartData["points"][number] = { month: "2026-03", label: "mar", fullLabel: "marzo de 2026", total: count * 100 }
  for (const { key } of series) point[key] = 100
  return { series, points: [point] }
}

interface Case {
  name: string
  ui: () => ReactElement
  list: string
  row: RegExp
}

const CASES: Case[] = [
  {
    name: "dispersión de L/h (telemetría contra cargas)",
    ui: () => <LphScatterChart view={LPH} />,
    list: "Equipos y meses con más diferencia entre la telemetría y las cargas",
    row: /KC-3 · mar/,
  },
  {
    name: "ranking de faenas por litros",
    ui: () => <OverviewRankingChart items={[{ name: "Faena Norte", liters: 1200 }, { name: "Faena Sur", liters: 800 }]} unitLabel="km/L" />,
    list: "Faenas con más litros en equipos de km/L",
    row: /Faena Norte/,
  },
  {
    name: "evolución por equipo (small multiples)",
    ui: () => <EvolutionByVehicleChart view={PANELS} />,
    list: "Litros por equipo en el período",
    row: /KA-1 · AA0001/,
  },
  {
    name: "litros contra odómetro (dispersión)",
    ui: () => (
      <LitersVsKmChart
        points={[{ plate: "AA0001", equipmentCode: "KA-1", equipmentTypeName: null, worksiteName: null, liters: 50, meterReading: 12000, medidoPor: "km" }]}
      />
    ),
    list: "Cargas con más litros y su odómetro",
    row: /KA-1 · AA0001/,
  },
  {
    name: "ranking de patentes",
    ui: () => (
      <PatenteRankingChart
        metric="cantidad"
        data={[
          { patente: "AA0001", cantidad: 100, monto: 1000, transacciones: 2, vehicleId: "v1" },
          { patente: "BB0002", cantidad: 80, monto: 800, transacciones: 1, vehicleId: null },
        ]}
      />
    ),
    list: "Ranking de patentes por cantidad",
    row: /AA0001/,
  },
  {
    name: "rendimiento por patente",
    ui: () => <RendimientoChart unitLabel="km/L" data={[{ patente: "AA0001", rendimiento: 3.2, cantidad: 100, atipico: true, vehicleId: "v1" }]} />,
    list: "Rendimiento promedio por patente en km/L",
    row: /AA0001/,
  },
  {
    name: "Pareto de proveedores",
    ui: () => <SupplierParetoChart rows={PARETO} thresholdPct={80} />,
    list: "Gasto por proveedor, de mayor a menor",
    row: /Proveedor Uno/,
  },
]

describe.each(CASES)("$name", ({ ui, list, row }) => {
  it("con la pantalla ancha no monta el reemplazo", () => {
    viewport(false)
    const { container } = render(ui())
    expect(screen.queryByRole("list", { name: list })).toBeNull()
    expect(container.querySelector("[data-dense-fallback]")).toBeNull()
  })

  it("bajo 360 px lo reemplaza por su ranking, que lleva las mismas filas y avisa por qué", () => {
    viewport(true)
    const { container } = render(ui())
    const fallback = container.querySelector("[data-dense-fallback]")
    expect(fallback).not.toBeNull()
    expect(within(fallback as HTMLElement).getByText(/se muestra como lista/i)).toBeDefined()
    const items = within(screen.getByRole("list", { name: list })).getAllByRole("listitem")
    expect(items.some((item) => row.test(item.textContent ?? ""))).toBe(true)
    // Nada del gráfico queda montado: ni el `<svg>` de recharts ni su contenedor.
    expect(container.querySelector(".recharts-wrapper")).toBeNull()
    expect(container.querySelector("svg.recharts-surface")).toBeNull()
  })
})

describe("columnas apiladas: sólo se reemplazan con más de 6 segmentos", () => {
  it("con 7 medios de suministro, bajo 360 px pasan a una lista de litros por medio", () => {
    viewport(true)
    const { container } = render(<OverviewMonthlyChart data={stacked(7)} />)
    expect(container.querySelector("[data-dense-fallback]")).not.toBeNull()
    const items = within(screen.getByRole("list", { name: "Litros por medio de suministro en el período" })).getAllByRole("listitem")
    expect(items).toHaveLength(7)
    expect(items[0]!.textContent).toMatch(/Medio 1/)
    expect(items[0]!.textContent).toMatch(/100 L/)
    expect(container.querySelector(".recharts-wrapper")).toBeNull()
  })

  it("con 6 caben: el gráfico se queda aunque la pantalla sea angosta", () => {
    viewport(true)
    const { container } = render(<OverviewMonthlyChart data={stacked(6)} />)
    expect(container.querySelector("[data-dense-fallback]")).toBeNull()
    expect(screen.queryByRole("list", { name: "Litros por medio de suministro en el período" })).toBeNull()
    expect(screen.getByRole("img", { name: /Litros por mes y medio de suministro/ })).toBeDefined()
  })
})

describe("enlaces del reemplazo", () => {
  it("el ranking de patentes enlaza a la ficha sólo cuando la patente es un equipo de la flota", () => {
    viewport(true)
    render(CASES[4]!.ui())
    const links = within(screen.getByRole("list", { name: "Ranking de patentes por cantidad" })).getAllByRole("link")
    expect(links).toHaveLength(1)
    expect(links[0]!.textContent).toMatch(/AA0001/)
  })

  it("el Pareto conserva el enlace a las OC del proveedor y «Otros proveedores» no lo tiene", () => {
    viewport(true)
    render(CASES[6]!.ui())
    const list = screen.getByRole("list", { name: "Gasto por proveedor, de mayor a menor" })
    const links = within(list).getAllByRole("link")
    expect(links).toHaveLength(1)
    expect(links[0]!.getAttribute("href")).toBe("/compras?proveedor=p1")
  })

  it("la dispersión de L/h dice, fila por fila, si el par cae dentro o fuera de la banda", () => {
    viewport(true)
    render(CASES[0]!.ui())
    const items = within(screen.getByRole("list", { name: CASES[0]!.list })).getAllByRole("listitem")
    // El más lejano de la diagonal va primero.
    expect(items[0]!.textContent).toMatch(/KC-3 · mar/)
    expect(items[0]!.textContent).toMatch(/fuera de la banda/)
    expect(items[1]!.textContent).toMatch(/dentro de la banda/)
  })
})

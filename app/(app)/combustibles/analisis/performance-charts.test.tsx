// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { PerformanceGroup } from "@/lib/combustibles/equipment-performance"

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

// Recharts mide el DOM; aquí basta con exponer la barra y su onClick.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => <div data-testid="bar-chart" data-points={data.length}>{children}</div>,
  Bar: ({ onClick, data, children }: { onClick?: (entry: unknown) => void; data?: unknown; children?: React.ReactNode }) => (
    <button type="button" data-testid="bar" onClick={() => onClick?.({ payload: (globalThis as { __point?: unknown }).__point })}>{String(data ?? "")}{children}</button>
  ),
  Cell: () => null,
  ErrorBar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
}))

import { PerformanceGroupChart } from "./performance-charts"
import { buildGroupDrilldownHrefs, groupHrefKey } from "./drilldown-hrefs"

afterEach(() => { cleanup(); push.mockClear() })

function group(overrides: Partial<PerformanceGroup> = {}): PerformanceGroup {
  return {
    key: "w-1",
    label: "Faena Norte",
    unit: "km_per_liter",
    stats: { count: 6, mean: 2.5, median: 2.5, min: 2, max: 3, stdDev: 0.3, coefficientOfVariation: 12, p10: 2.1, p90: 2.9 },
    reliability: "confiable",
    previousMean: null,
    variationPct: null,
    expectedRange: null,
    vehicleIds: ["v-1"],
    singlePlate: null,
    trend: null,
    periodMeans: [],
    periodLabels: [],
    values: [2, 3],
    ...overrides,
  } as PerformanceGroup
}

describe("D-12: hrefs precalculados del gráfico de rendimiento", () => {
  it("la página entrega datos serializables: un Record de strings, sin funciones", () => {
    const hrefs = buildGroupDrilldownHrefs([group(), group({ key: "v-1", singlePlate: "AB-1234" })], { worksiteId: "w-1", from: "2026-01-01", to: "2026-03-31" })
    expect(Object.values(hrefs).every((href) => typeof href === "string")).toBe(true)
    expect(JSON.parse(JSON.stringify(hrefs))).toEqual(hrefs)
    expect(hrefs[groupHrefKey(group())]).toBe("/combustibles/bitacora?desde=2026-01-01&hasta=2026-03-31&faena=w-1")
    expect(hrefs[groupHrefKey(group({ key: "v-1" }))]).toBe("/combustibles/bitacora?desde=2026-01-01&hasta=2026-03-31&q=AB-1234&faena=w-1")
  })

  it("separa por unidad: la misma faena en km/L y L/h no comparte clave", () => {
    expect(groupHrefKey(group())).not.toBe(groupHrefKey(group({ unit: "liters_per_hour" })))
  })

  it("renderiza con datos planos y navega al href de la barra pulsada", () => {
    const g = group()
    const hrefs = buildGroupDrilldownHrefs([g], { from: "2026-01-01", to: "2026-03-31" })
    ;(globalThis as { __point?: unknown }).__point = { group: g }
    render(<PerformanceGroupChart groups={[g]} hrefs={hrefs} />)
    expect(screen.getByTestId("bar-chart")).toHaveAttribute("data-points", "1")
    fireEvent.click(screen.getByTestId("bar"))
    expect(push).toHaveBeenCalledWith("/combustibles/bitacora?desde=2026-01-01&hasta=2026-03-31")
  })

  it("no navega si el grupo no tiene href", () => {
    const g = group()
    ;(globalThis as { __point?: unknown }).__point = { group: g }
    render(<PerformanceGroupChart groups={[g]} hrefs={{}} />)
    fireEvent.click(screen.getByTestId("bar"))
    expect(push).not.toHaveBeenCalled()
  })
})

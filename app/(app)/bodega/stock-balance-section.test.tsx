// @vitest-environment jsdom
/**
 * CHART-035b · la sección del saldo. recharts no mide en jsdom, así que el trazado
 * se sustituye: lo que se verifica es lo que la sección decide (la frase, la
 * alternativa en datos y el estado vacío con su salida).
 */
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { shapeBalanceSeries } from "@/lib/bodega/balance-series"

vi.mock("./stock-balance-chart-lazy", () => ({ StockBalanceChart: () => <div data-testid="trazado" /> }))

import { StockBalanceSection } from "./stock-balance-section"
import { StockBalanceChart } from "./stock-balance-chart"

afterEach(cleanup)

const series = shapeBalanceSeries(
  [
    { performedAt: "2026-10-01T15:00:00.000Z", stockBefore: 0, stockAfter: 100 },
    { performedAt: "2026-10-03T15:00:00.000Z", stockBefore: 100, stockAfter: 40 },
  ],
  { from: "2026-10-01", to: "2026-10-06", today: "2026-10-06" },
)!

const empty = { label: "Sin movimientos", hint: "Cuando entre stock, lo verás aquí.", ctaLabel: "Ver los últimos 12 meses", ctaHref: "/bodega?desde=2025-11-04" }
const base = { productName: "Guante", worksiteName: "Cholguán", unit: "par", empty }

describe("StockBalanceSection", () => {
  it("responde antes del dibujo y deja la alternativa en datos", () => {
    render(<StockBalanceSection {...base} series={series} truncated={false} />)
    expect(screen.getByRole("heading", { name: "Saldo en el tiempo" })).toBeTruthy()
    expect(screen.getByText(/pasó de 0 a 40 pares/)).toBeTruthy()
    expect(screen.getByTestId("trazado")).toBeTruthy()
    expect(screen.getByText("Ver datos")).toBeTruthy()
  })

  it("si había más movimientos que el tope lo dice, con cuántos se muestran", () => {
    render(<StockBalanceSection {...base} series={series} truncated />)
    expect(screen.getByText(/se muestran los 2 más recientes/)).toBeTruthy()
  })

  it("sin movimientos explica el vacío y ofrece ampliar la ventana (A4)", () => {
    render(<StockBalanceSection {...base} series={null} truncated={false} />)
    expect(screen.queryByTestId("trazado")).toBeNull()
    expect(screen.getByText("Sin movimientos")).toBeTruthy()
    expect(screen.getByRole("link", { name: /Ver los últimos 12 meses/ }).getAttribute("href")).toBe("/bodega?desde=2025-11-04")
  })
})

describe("StockBalanceChart", () => {
  it("dibuja el contenedor del gráfico", () => {
    const { container } = render(<StockBalanceChart series={series} />)
    expect(container.querySelector("[data-chart]")).not.toBeNull()
  })

  it("por semana avisa que la última barra sigue en curso", () => {
    const weekly = shapeBalanceSeries(
      [{ performedAt: "2026-07-02T15:00:00.000Z", stockBefore: 0, stockAfter: 50 }],
      { from: "2026-07-01", to: "2026-11-03", today: "2026-11-03" },
    )!
    render(<StockBalanceChart series={weekly} />)
    expect(screen.getByText(/Cada barra es una semana \(de lunes a domingo\); la última sigue en curso/)).toBeTruthy()
  })
})

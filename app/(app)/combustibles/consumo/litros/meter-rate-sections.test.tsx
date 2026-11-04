import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { PerformanceUnit } from "@/lib/combustibles/control/contracts"
import type { MeterRateMonth, MeterRateSeries } from "@/lib/combustibles/meter-rate-series"

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
// Recharts sólo corre en el navegador: acá importa lo que la sección dice alrededor del gráfico.
vi.mock("../../control/_charts/overview-charts-lazy", () => ({ MeterRateChart: ({ series }: { series: { unit: string } }) => <div data-testid="rate-chart">{series.unit}</div> }))

import { MeterRateSections } from "./meter-rate-sections"

const month = (overrides: Partial<MeterRateMonth> & { month: string }): MeterRateMonth => ({
  measure: 400, liters: 160, segments: 4, equipment: 2, discarded: 0, rate: 2.5, status: "ok", partial: false, ...overrides,
})
const series = (unit: PerformanceUnit, overrides: Partial<MeterRateSeries> = {}): MeterRateSeries => ({
  unit, months: [month({ month: "2026-09" }), month({ month: "2026-10" })], rate: 2.5, measure: 800, liters: 320, segments: 8, equipment: 2, discarded: 0, readings: 12, status: "ok", ...overrides,
})
const NONE = (unit: PerformanceUnit) => series(unit, { months: [], rate: null, measure: 0, liters: 0, segments: 0, equipment: 0, readings: 0, status: "empty" })
const html = (km: MeterRateSeries, hours: MeterRateSeries) =>
  renderToStaticMarkup(<MeterRateSections series={{ km_per_liter: km, liters_per_hour: hours }} sourcesHref="/combustibles/fuentes?periodo=2026-10" />)

describe("MeterRateSections", () => {
  it("dibuja sólo la unidad que tiene lecturas, con su frase y su «Ver datos»", () => {
    const out = html(series("km_per_liter"), NONE("liters_per_hour"))

    expect(out).toContain("Equipos con odómetro · km/L")
    expect(out).not.toContain("Equipos con horómetro")
    expect(out).toContain("2,5 km/L")
    expect(out).toContain("Ver datos")
    expect(out).toContain("Rendimiento (km/L)")
    expect(out).toContain("n = tramos")
    expect(out).toContain('data-testid="rate-chart"')
  })

  it("con las dos unidades hay un gráfico por unidad: nunca km/L y L/h en el mismo eje", () => {
    const out = html(series("km_per_liter"), series("liters_per_hour", { rate: 14 }))

    expect(out.match(/data-testid="rate-chart"/g)).toHaveLength(2)
    expect(out).toContain("Equipos con horómetro · L/h")
    expect(out).toContain("14 L/h")
  })

  it("sin lecturas de ninguna unidad explica el vacío y ofrece el camino (un enlace real a Fuentes)", () => {
    const out = html(NONE("km_per_liter"), NONE("liters_per_hour"))

    expect(out).toContain("Todavía no hay lecturas de odómetro ni de horómetro de Copec")
    expect(out).toContain('href="/combustibles/fuentes?periodo=2026-10"')
    expect(out).not.toContain('data-testid="rate-chart"')
  })

  it("con lecturas pero pocos tramos dice «datos insuficientes» y no una cifra", () => {
    const out = html(series("km_per_liter", { rate: null, segments: 2, status: "insufficient", months: [month({ month: "2026-10", rate: null, status: "insufficient", segments: 2 })] }), NONE("liters_per_hour"))

    expect(out).toContain("Datos insuficientes: sólo 2 tramos")
    expect(out).not.toContain("rinden 2,5 km/L")
  })
})

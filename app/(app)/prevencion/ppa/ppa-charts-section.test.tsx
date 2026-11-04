// @vitest-environment jsdom

/**
 * CHART-011: ningún porcentaje del PPA sale solo. Con pocos PPA la tasa es «datos
 * insuficientes» y se dice cuántos hay; con base suficiente la tasa lleva su n.
 */
import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { PpaCountRankingSection, PpaTrendSection, PpaWorksiteRateSection } from "./ppa-charts-section"
import { PpaMetricBar } from "./ppa-metric-bar"
import { shapePpaMonthly, shapeWorksiteRanking } from "@/lib/ppa/detention-rate"
import type { PpaStats } from "@/lib/services/ppa"

const stats = (over: Partial<PpaStats>): PpaStats => ({
  total: 0, detenidos: 0, aprobadosAuto: 0, autorizados: 0, rechazados: 0, pendientes: 0,
  porcentajeDesviaciones: 0, avgResponseMinutes: null, topReasons: [], topTareas: [], topFaenas: [],
  ...over,
})

describe("PpaMetricBar — la tasa de detención nunca va pelada", () => {
  it("con pocos PPA dice «Datos insuficientes» y la base, sin porcentaje", () => {
    const { container } = render(<PpaMetricBar stats={stats({ total: 4, detenidos: 1, porcentajeDesviaciones: 25 })} />)
    expect(screen.getByText("Datos insuficientes")).toBeDefined()
    expect(screen.getByText(/1 de 4 PPA detenido; se necesitan 20 para una tasa/)).toBeDefined()
    expect(container.textContent).not.toContain("25%")
  })

  it("con base suficiente muestra la tasa con cuántos detenidos y de cuántos", () => {
    render(<PpaMetricBar stats={stats({ total: 22, detenidos: 6, porcentajeDesviaciones: 27 })} />)
    expect(screen.getByText("27,3%")).toBeDefined()
    expect(screen.getByText("6 de 22 PPA detenidos")).toBeDefined()
  })

  it("con los once PPA que hay hoy en producción no hay tasa, sólo la base", () => {
    const { container } = render(<PpaMetricBar stats={stats({ total: 11, detenidos: 3, porcentajeDesviaciones: 27 })} />)
    expect(screen.getByText("Datos insuficientes")).toBeDefined()
    expect(screen.getByText(/3 de 11 PPA detenidos; se necesitan 20 para una tasa/)).toBeDefined()
    expect(container.textContent).not.toContain("27")
  })

  it("sin ningún PPA no inventa un 0 %", () => {
    const { container } = render(<PpaMetricBar stats={stats({})} />)
    expect(screen.getByText("Sin PPA")).toBeDefined()
    expect(container.textContent).not.toContain("0%")
  })
})

describe("PpaWorksiteRateSection", () => {
  it("ordena por tasa, muestra la base de cada faena y nombra aparte las de pocos PPA", () => {
    const ranking = shapeWorksiteRanking([
      { worksiteId: "a", worksiteName: "Faena A", total: 40, detained: 4 },
      { worksiteId: "b", worksiteName: "Faena B", total: 20, detained: 10 },
      { worksiteId: "c", worksiteName: "Faena C", total: 2, detained: 2 },
    ])
    render(<PpaWorksiteRateSection ranking={ranking} />)

    const list = screen.getByRole("list", { name: "Tasa de detención por faena" })
    const rows = within(list).getAllByRole("listitem")
    expect(rows[0]!.textContent).toContain("Faena B")
    expect(rows[0]!.textContent).toContain("50%")
    expect(rows[0]!.textContent).toContain("10 de 20 PPA detenidos")
    expect(rows[1]!.textContent).toContain("Faena A")
    // La C tiene dos PPA y ambos detenidos: un 100 % que no significa nada. No entra al ranking.
    expect(list.textContent).not.toContain("Faena C")
    expect(screen.getByText(/Datos insuficientes \(menos de 20 PPA, sin tasa\): Faena C \(2\)\./)).toBeDefined()
  })

  it("si ninguna faena alcanza el mínimo explica el vacío con las cifras reales y no dibuja un ranking", () => {
    const ranking = shapeWorksiteRanking([
      { worksiteId: "a", worksiteName: "Faena A", total: 5, detained: 1 },
      { worksiteId: "b", worksiteName: "Faena B", total: 3, detained: 0 },
    ])
    render(<PpaWorksiteRateSection ranking={ranking} />)
    expect(screen.getByText("Ninguna faena tiene PPA suficientes para comparar")).toBeDefined()
    expect(screen.getByText(/Hoy: Faena A 5, Faena B 3\./)).toBeDefined()
    expect(screen.queryByRole("list", { name: "Tasa de detención por faena" })).toBeNull()
  })

  it("sin PPA no dibuja nada", () => {
    const { container } = render(<PpaWorksiteRateSection ranking={shapeWorksiteRanking([])} />)
    expect(container.firstChild).toBeNull()
  })
})

describe("PpaTrendSection", () => {
  it("con pocos PPA la frase dice «datos insuficientes» y no entrega un porcentaje", () => {
    const points = shapePpaMonthly([{ month: "2026-10", total: 4, detained: 1 }], "2026-10-20")
    const { container } = render(<PpaTrendSection points={points} />)
    expect(screen.getByRole("heading", { name: "Tasa de detención por mes" })).toBeDefined()
    expect(screen.getByText(/datos insuficientes para una tasa de detención/)).toBeDefined()
    expect(container.querySelector('[data-chart-kind="monthly-trend"]')).not.toBeNull()
  })

  it("sin PPA no dibuja nada", () => {
    const { container } = render(<PpaTrendSection points={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe("PpaCountRankingSection", () => {
  it("es la lista compartida con un nombre accesible, no un panel local", () => {
    render(<PpaCountRankingSection title="Motivos de alerta más frecuentes" ariaLabel="Motivos de alerta más frecuentes" items={[
      { key: "a", label: "Sin arnés", value: 4 },
      { key: "b", label: "Sin permiso", value: 3 },
      { key: "c", label: "Sin capacitación", value: 1 },
    ]} />)
    expect(screen.getByRole("list", { name: "Motivos de alerta más frecuentes" })).toBeDefined()
    expect(screen.getByRole("heading", { name: "Motivos de alerta más frecuentes" })).toBeDefined()
  })
})

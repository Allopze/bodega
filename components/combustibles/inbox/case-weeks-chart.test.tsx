// @vitest-environment jsdom
/**
 * Gráfico semanal de casos (CHART-023b). recharts no mide en jsdom, así que aquí sólo
 * se comprueba lo que el componente decide: el marco del gráfico y el aviso de que la
 * última columna es la semana en curso. Las cifras y el orden los cubre `case-weeks.test.ts`.
 */
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { shapeAnomalyWeeks } from "@/lib/combustibles/inbox/case-weeks"
import { CaseWeeksChart } from "./case-weeks-chart"

afterEach(() => cleanup())

const NOW = new Date("2026-11-03T15:00:00.000Z")
const weeks = shapeAnomalyWeeks(
  [
    { weekStart: "2026-10-26", severity: "high", count: 2 },
    { weekStart: "2026-11-02", severity: "medium", count: 1 },
  ],
  { now: NOW, weeks: 4 },
)

describe("CaseWeeksChart", () => {
  it("dibuja el gráfico y avisa que la última columna, punteada, es la semana en curso", () => {
    const { container } = render(<CaseWeeksChart weeks={weeks} />)
    expect(container.querySelector("[data-chart]")).not.toBeNull()
    expect(screen.getByText(/La última columna, punteada, es la semana en curso/)).toBeInTheDocument()
  })

  it("sin semana parcial en la serie no inventa el aviso", () => {
    render(<CaseWeeksChart weeks={weeks.map((week) => ({ ...week, partial: false }))} />)
    expect(screen.queryByText(/semana en curso/)).toBeNull()
  })
})

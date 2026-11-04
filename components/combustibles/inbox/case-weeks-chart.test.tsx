// @vitest-environment jsdom
/**
 * Gráfico semanal de casos (CHART-023b). recharts no mide en jsdom, así que aquí sólo
 * se comprueba lo que el componente decide: el marco del gráfico y el aviso de que la
 * última columna es la semana en curso. Las cifras y el orden los cubre `case-weeks.test.ts`.
 */
import React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Recharts de verdad salvo el contenedor: jsdom no mide y sin tamaño no dibuja (sin esto no hay líneas que contar).
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) => React.cloneElement(children, { width: 640, height: 224 }),
  }
})

import { shapeAnomalyRuleChanges, shapeAnomalyWeeks } from "@/lib/combustibles/inbox/case-weeks"
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

  it("marca con una línea punteada cada semana en que cambió una regla y lo explica en una nota; sin cambios no hay ni línea ni nota", () => {
    const changes = shapeAnomalyRuleChanges(
      [
        { ruleCode: "sello_repetido", ruleName: "Sello repetido", kind: "created", source: "rule", day: "2026-10-28", weekStart: "2026-10-26", epoch: 1 },
        // Dos cambios en la misma semana: una sola línea.
        { ruleCode: "sello_repetido", ruleName: "Sello repetido", kind: "changed", source: "audit", day: "2026-10-30", weekStart: "2026-10-26", epoch: 2 },
      ],
      { now: NOW, weeks: 4 },
    )
    const { container, rerender } = render(<CaseWeeksChart weeks={weeks} ruleChanges={changes} />)
    expect(container.querySelectorAll(".recharts-reference-line")).toHaveLength(1)
    expect(screen.getByText(/Las líneas verticales punteadas marcan las semanas en que se creó o se modificó una regla de detección/)).toBeInTheDocument()
    expect(screen.getByText(/El detalle está en «Ver datos»/)).toBeInTheDocument()

    rerender(<CaseWeeksChart weeks={weeks} />)
    expect(container.querySelectorAll(".recharts-reference-line")).toHaveLength(0)
    expect(screen.queryByText(/líneas verticales punteadas/)).toBeNull()
  })
})

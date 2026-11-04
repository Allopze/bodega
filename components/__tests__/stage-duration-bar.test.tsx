// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { StageDurationBar, durationLabel, formatLeadDays, stageFill } from "@/components/charts/stage-duration-bar"
import type { DurationStat, LeadTimeGroup } from "@/lib/services/analytics-module/lead-time-shape"

const stat = (n: number, median: number | null, p90: number | null = null): DurationStat => ({ n, median, p90, insufficient: median === null })

function group(key: string, label: string, stages: Array<[string, string, DurationStat]>, total: DurationStat): LeadTimeGroup {
  return {
    key,
    label,
    closedItems: total.n,
    stages: stages.map(([stageKey, stageLabel, value]) => ({ key: stageKey as never, label: stageLabel, ...value })),
    total,
  }
}

const STAGES = (a: DurationStat, b: DurationStat, c: DurationStat, d: DurationStat): Array<[string, string, DurationStat]> => [
  ["approval", "Aprobación", a], ["purchase", "Emisión de OC", b], ["arrival", "Llegada", c], ["delivery", "Entrega", d],
]

describe("formatLeadDays", () => {
  it("singular y plural, con un decimal sólo si hace falta", () => {
    expect(formatLeadDays(1)).toBe("1 día")
    expect(formatLeadDays(0)).toBe("0 días")
    expect(formatLeadDays(6.5)).toBe("6,5 días")
    expect(formatLeadDays(10)).toBe("10 días")
  })
})

describe("durationLabel", () => {
  it("nunca la cifra sola: va con su n", () => {
    expect(durationLabel(stat(24, 9))).toBe("Mediana 9 días · n = 24")
    expect(durationLabel(stat(24, 9, 21))).toBe("Mediana 9 días · n = 24 · P90 21 días")
  })

  it("con muestra insuficiente no hay cifra, sólo el n", () => {
    expect(durationLabel(stat(3, null))).toBe("Datos insuficientes · n = 3")
  })
})

describe("stageFill", () => {
  it("rampa de un matiz, de clara a oscura, en OKLab; el último tramo es el tono pleno", () => {
    expect(stageFill(0, 4)).toBe("color-mix(in oklab, var(--color-chart-2) 35%, var(--color-surface))")
    expect(stageFill(3, 4)).toBe("var(--color-chart-2)")
  })

  it("dos tramos vecinos nunca comparten tono y nunca se interpola en oklch", () => {
    const fills = [0, 1, 2, 3].map((i) => stageFill(i, 4))
    for (let i = 1; i < fills.length; i += 1) expect(fills[i]).not.toBe(fills[i - 1])
    expect(fills.join(" ")).not.toContain("oklch")
  })
})

describe("StageDurationBar", () => {
  const overall = group("all", "Todas las faenas", STAGES(stat(24, 2), stat(24, 3), stat(22, 6), stat(3, null)), stat(24, 9, 21))
  const small = group("ws-a", "Faena A", STAGES(stat(3, null), stat(3, null), stat(3, null), stat(0, null)), stat(3, null))

  it("cada cifra lleva su n y un tramo con pocos datos dice «datos insuficientes» en vez de un número", () => {
    render(<StageDurationBar groups={[overall, small]} ariaLabel="Plazos" />)

    const list = screen.getByRole("list", { name: "Plazos" })
    expect(within(list).getByText("Mediana 9 días · n = 24 · P90 21 días")).toBeInTheDocument()
    expect(within(list).getByText("Datos insuficientes · n = 3")).toBeInTheDocument()
    // El tramo de entrega de «Todas las faenas» (n = 3) no muestra mediana.
    expect(within(list).getAllByText("datos insuficientes (n = 3)").length).toBeGreaterThanOrEqual(1)
    // Ningún tramo suelta su cifra sin el n.
    expect(document.body.textContent).toMatch(/Aprobación\s*2 días\s*\(n = 24\)/)
    expect(document.body.textContent).toMatch(/Llegada\s*6 días\s*\(n = 22\)/)
  })

  it("dibuja un segmento por tramo con mediana, nunca uno para un tramo sin datos, y una marca P90 sólo si hay P90", () => {
    const { container } = render(<StageDurationBar groups={[overall, small]} ariaLabel="Plazos" />)

    const rows = container.querySelectorAll(":scope > div > ul > li")
    expect(rows[0]!.querySelectorAll("[data-stage]")).toHaveLength(3)
    expect(rows[0]!.querySelectorAll("[data-p90]")).toHaveLength(1)
    expect(rows[1]!.querySelectorAll("[data-stage]")).toHaveLength(0)
    expect(rows[1]!.querySelectorAll("[data-p90]")).toHaveLength(0)
  })

  it("todas las barras miden contra la misma escala: un grupo más lento se ve más largo", () => {
    const fast = group("fast", "Rápida", STAGES(stat(10, 1), stat(10, 1), stat(10, 1), stat(10, 1)), stat(10, 4))
    const slow = group("slow", "Lenta", STAGES(stat(10, 3), stat(10, 3), stat(10, 3), stat(10, 3)), stat(10, 12))
    const { container } = render(<StageDurationBar groups={[fast, slow]} ariaLabel="Plazos" />)

    const width = (row: number) => {
      const segments = Array.from(container.querySelectorAll(":scope > div > ul > li")[row]!.querySelectorAll<HTMLElement>("[data-stage]"))
      return segments.reduce((sum, segment) => sum + parseFloat(segment.style.width), 0)
    }
    expect(width(1)).toBeCloseTo(100, 5)
    expect(width(0)).toBeCloseTo(100 / 3, 5)
  })

  it("las barras son decoración: el significado está en el texto (no hay role=img con enlaces ni controles dentro)", () => {
    const { container } = render(<StageDurationBar groups={[overall]} ariaLabel="Plazos" />)

    expect(container.querySelector("[role=img]")).toBeNull()
    expect(container.querySelectorAll("a, button")).toHaveLength(0)
    expect(container.querySelector("[data-stage]")!.parentElement).toHaveAttribute("aria-hidden", "true")
  })

  it("compara el total con el período anterior sólo si los dos tienen muestra, y un alza de plazo es mala", () => {
    const { rerender } = render(<StageDurationBar groups={[overall]} previousTotal={stat(19, 8)} ariaLabel="Plazos" />)
    // 9 contra 8: +12,5 %.
    expect(screen.getAllByText(/vs\. período anterior \(n = 19\)/).length).toBeGreaterThan(0)

    rerender(<StageDurationBar groups={[overall]} previousTotal={stat(2, null)} ariaLabel="Plazos" />)
    expect(screen.queryByText(/vs\. período anterior/)).toBeNull()
  })

  it("explica por qué la barra no es la mediana del total", () => {
    render(<StageDurationBar groups={[overall]} ariaLabel="Plazos" />)

    expect(screen.getByText(/no es la suma de los tramos/)).toBeInTheDocument()
  })
})

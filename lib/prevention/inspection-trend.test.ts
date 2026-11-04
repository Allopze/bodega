import { describe, expect, it } from "vitest"
import {
  inspectionTrendDataTable,
  shapeInspectionTrend,
  summarizeInspectionTrend,
  type InspectionTrendRow,
} from "./inspection-trend"

const row = (over: Partial<InspectionTrendRow> & { month: string }): InspectionTrendRow => ({
  runs: 0, scoredRuns: 0, scoredItems: 0, weightedPoints: 0, openFindings: 0, criticalOpenFindings: 0, ...over,
})

describe("shapeInspectionTrend", () => {
  it("pondera por ítems y no promedia porcentajes", () => {
    // Una inspección de 10 ítems al 100 % y otra de 90 ítems al 50 %: el promedio
    // de porcentajes diría 75 %; ponderado por ítems es (1000 + 4500) / 100 = 55 %.
    const [point] = shapeInspectionTrend(
      [row({ month: "2026-10", runs: 2, scoredRuns: 2, scoredItems: 100, weightedPoints: 100 * 10 + 50 * 90 })],
      "2026-10-20",
    )
    expect(point?.compliancePercent).toBe(55)
  })

  it("un mes sin ítems evaluados es «sin dato», no 0 %", () => {
    const [point] = shapeInspectionTrend([row({ month: "2026-10", runs: 3 })], "2026-10-20")
    expect(point?.compliancePercent).toBeNull()
    expect(point?.runs).toBe(3)
  })

  it("el mes sin inspecciones entre dos con datos queda como hueco, y el mes en curso como parcial", () => {
    const points = shapeInspectionTrend(
      [
        row({ month: "2026-08", runs: 1, scoredRuns: 1, scoredItems: 20, weightedPoints: 20 * 80 }),
        row({ month: "2026-10", runs: 1, scoredRuns: 1, scoredItems: 20, weightedPoints: 20 * 90 }),
      ],
      "2026-11-03",
    )
    expect(points.map((p) => [p.month, p.runs, p.compliancePercent, p.partial])).toEqual([
      ["2026-08", 1, 80, false],
      ["2026-09", 0, null, false],
      ["2026-10", 1, 90, false],
      ["2026-11", 0, null, true],
    ])
  })

  it("redondea a un decimal", () => {
    const [point] = shapeInspectionTrend([row({ month: "2026-10", runs: 1, scoredRuns: 1, scoredItems: 3, weightedPoints: 3 * 66.666 })], "2026-10-02")
    expect(point?.compliancePercent).toBe(66.7)
  })
})

describe("summarizeInspectionTrend", () => {
  const shape = (rows: InspectionTrendRow[], today: string) => shapeInspectionTrend(rows, today)

  it("sin puntos no dice nada", () => {
    expect(summarizeInspectionTrend([])).toBe("")
  })

  it("compara los dos últimos meses completos y contiguos", () => {
    const points = shape(
      [
        row({ month: "2026-08", runs: 2, scoredRuns: 2, scoredItems: 40, weightedPoints: 40 * 70 }),
        row({ month: "2026-09", runs: 3, scoredRuns: 3, scoredItems: 60, weightedPoints: 60 * 80 }),
      ],
      "2026-10-05",
    )
    const text = summarizeInspectionTrend(points)
    expect(text).toContain("entre agosto y septiembre")
    expect(text).toContain("5 inspecciones")
    expect(text).toContain("100 ítems evaluados")
    expect(text).toContain("En septiembre fue de 80%, 10 puntos sobre agosto.")
  })

  it("no afirma tendencia si falta el mes anterior: un hueco no permite decir «frente al anterior»", () => {
    const points = shape(
      [
        row({ month: "2026-07", runs: 1, scoredRuns: 1, scoredItems: 10, weightedPoints: 10 * 60 }),
        row({ month: "2026-09", runs: 1, scoredRuns: 1, scoredItems: 10, weightedPoints: 10 * 90 }),
      ],
      "2026-10-05",
    )
    const text = summarizeInspectionTrend(points)
    expect(text).not.toContain("sobre")
    expect(text).not.toContain("bajo")
    expect(text.endsWith(".")).toBe(true)
  })

  it("el mes en curso no entra en la comparación: sus pocos días no son una caída", () => {
    const points = shape(
      [
        row({ month: "2026-09", runs: 4, scoredRuns: 4, scoredItems: 80, weightedPoints: 80 * 85 }),
        row({ month: "2026-10", runs: 1, scoredRuns: 1, scoredItems: 10, weightedPoints: 10 * 20 }),
      ],
      "2026-10-05",
    )
    const text = summarizeInspectionTrend(points)
    // Octubre es parcial: no hay dos meses completos, así que no hay comparación.
    expect(text).not.toContain("bajo septiembre")
    expect(text).not.toContain("En octubre fue")
  })

  it("dice «bajo» cuando empeora y «igual» cuando no cambia", () => {
    const down = shape(
      [
        row({ month: "2026-08", runs: 1, scoredRuns: 1, scoredItems: 10, weightedPoints: 10 * 90 }),
        row({ month: "2026-09", runs: 1, scoredRuns: 1, scoredItems: 10, weightedPoints: 10 * 82.5 }),
      ],
      "2026-10-05",
    )
    expect(summarizeInspectionTrend(down)).toContain("7,5 puntos bajo agosto")
    const flat = shape(
      [
        row({ month: "2026-08", runs: 1, scoredRuns: 1, scoredItems: 10, weightedPoints: 10 * 90 }),
        row({ month: "2026-09", runs: 1, scoredRuns: 1, scoredItems: 10, weightedPoints: 10 * 90 }),
      ],
      "2026-10-05",
    )
    expect(summarizeInspectionTrend(flat)).toContain("igual que en agosto")
  })

  it("con inspecciones pero ninguna con ítems evaluados no inventa un porcentaje", () => {
    const points = shape([row({ month: "2026-10", runs: 3 })], "2026-10-20")
    expect(summarizeInspectionTrend(points)).toBe(
      "3 inspecciones realizadas en el período, ninguna con ítems evaluados: todavía no hay un cumplimiento que calcular.",
    )
  })

  it("cuando la ventana cruza de año nombra el año", () => {
    const points = shape(
      [
        row({ month: "2025-12", runs: 1, scoredRuns: 1, scoredItems: 10, weightedPoints: 10 * 70 }),
        row({ month: "2026-01", runs: 1, scoredRuns: 1, scoredItems: 10, weightedPoints: 10 * 75 }),
      ],
      "2026-02-05",
    )
    expect(summarizeInspectionTrend(points)).toContain("entre diciembre de 2025 y enero de 2026")
  })
})

describe("inspectionTrendDataTable", () => {
  it("marca el mes en curso y deja «—» donde no hay porcentaje", () => {
    const points = shapeInspectionTrend(
      [row({ month: "2026-09", runs: 2, scoredRuns: 2, scoredItems: 20, weightedPoints: 20 * 80, openFindings: 3, criticalOpenFindings: 1 })],
      "2026-10-05",
    )
    const table = inspectionTrendDataTable(points)
    expect(table.headers[0]).toBe("Mes")
    expect(table.rows).toEqual([
      ["Sep 2026", 2, 20, "80%", 3, 1],
      ["Oct 2026 (en curso)", 0, 0, "—", 0, 0],
    ])
  })
})

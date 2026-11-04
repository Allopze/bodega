import { describe, expect, it } from "vitest"
import { alcotestTrendDataTable, shapeAlcotestTrend, summarizeAlcotestTrend } from "./alcotest-trend"

describe("shapeAlcotestTrend", () => {
  it("separa negativos de positivos y rellena el mes sin controles", () => {
    const points = shapeAlcotestTrend(
      [{ month: "2026-08", total: 10, positives: 1 }, { month: "2026-10", total: 4, positives: 0 }],
      "2026-10-20",
    )
    expect(points.map((p) => [p.month, p.total, p.negatives, p.positives, p.partial])).toEqual([
      ["2026-08", 10, 9, 1, false],
      ["2026-09", 0, 0, 0, false],
      ["2026-10", 4, 4, 0, true],
    ])
  })

  it("una fila inconsistente no dibuja una columna negativa", () => {
    const [point] = shapeAlcotestTrend([{ month: "2026-10", total: 1, positives: 3 }], "2026-10-02")
    expect(point?.negatives).toBe(0)
  })
})

describe("summarizeAlcotestTrend", () => {
  const shape = (rows: Array<{ month: string; total: number; positives: number }>, today = "2026-11-03") => shapeAlcotestTrend(rows, today)

  it("sin controles no dice nada: la lista de abajo ya explica el vacío", () => {
    expect(summarizeAlcotestTrend(shape([]))).toBe("")
  })

  it("un solo control dice su resultado, sin porcentajes", () => {
    expect(summarizeAlcotestTrend(shape([{ month: "2026-10", total: 1, positives: 0 }]))).toBe("1 control en octubre: resultó negativo.")
    expect(summarizeAlcotestTrend(shape([{ month: "2026-10", total: 1, positives: 1 }]))).toBe("1 control en octubre: resultó positivo.")
  })

  it("sin positivos lo dice con la base a la vista", () => {
    expect(summarizeAlcotestTrend(shape([
      { month: "2026-08", total: 12, positives: 0 },
      { month: "2026-10", total: 8, positives: 0 },
    ]))).toBe("20 controles entre agosto y octubre, ninguno positivo.")
  })

  it("con positivos da «X de N» y concuerda el verbo", () => {
    expect(summarizeAlcotestTrend(shape([{ month: "2026-09", total: 40, positives: 1 }])))
      .toBe("1 de 40 controles en septiembre resultó positivo.")
    expect(summarizeAlcotestTrend(shape([{ month: "2026-09", total: 40, positives: 3 }])))
      .toBe("3 de 40 controles en septiembre resultaron positivos.")
  })

  it("el mes en curso vacío no cuenta como rango", () => {
    // Noviembre es parcial y no tiene controles: la frase habla de los meses con controles.
    expect(summarizeAlcotestTrend(shape([{ month: "2026-10", total: 5, positives: 0 }]))).toBe("5 controles en octubre, ninguno positivo.")
  })
})

describe("alcotestTrendDataTable", () => {
  it("lista sólo conteos agregados y marca el mes en curso", () => {
    const table = alcotestTrendDataTable(shapeAlcotestTrend([{ month: "2026-10", total: 4, positives: 1 }], "2026-10-20"))
    expect(table.headers).toEqual(["Mes", "Controles", "Negativos", "Positivos"])
    expect(table.rows).toEqual([["Oct 2026 (en curso)", 4, 3, 1]])
  })
})

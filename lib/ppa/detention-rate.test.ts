import { describe, expect, it } from "vitest"
import {
  PPA_RATE_MIN_SAMPLE,
  detentionBasis,
  detentionRate,
  ppaMonthNote,
  ppaTrendDataTable,
  shapePpaMonthly,
  shapeWorksiteRanking,
  summarizePpaTrend,
} from "./detention-rate"

describe("detentionRate", () => {
  it("bajo el mínimo no hay tasa: son datos insuficientes y conserva su base", () => {
    expect(detentionRate(3, PPA_RATE_MIN_SAMPLE - 1)).toEqual({ sufficient: false, n: PPA_RATE_MIN_SAMPLE - 1, detained: 3 })
    expect(detentionRate(0, 0)).toEqual({ sufficient: false, n: 0, detained: 0 })
  })

  it("desde el mínimo calcula la tasa con un decimal y lleva la base", () => {
    expect(detentionRate(6, 22)).toEqual({ sufficient: true, percent: 27.3, n: 22, detained: 6 })
    expect(detentionRate(0, PPA_RATE_MIN_SAMPLE)).toEqual({ sufficient: true, percent: 0, n: PPA_RATE_MIN_SAMPLE, detained: 0 })
  })

  it("los once PPA que hay hoy en producción no alcanzan para una tasa", () => {
    expect(detentionRate(3, 11).sufficient).toBe(false)
  })

  it("dice la base con concordancia", () => {
    expect(detentionBasis(detentionRate(1, 25))).toBe("1 de 25 PPA detenido")
    expect(detentionBasis(detentionRate(6, 22))).toBe("6 de 22 PPA detenidos")
  })
})

describe("shapePpaMonthly", () => {
  it("rellena el mes sin PPA, marca el actual como parcial y corta la tasa bajo el mínimo", () => {
    const points = shapePpaMonthly(
      [{ month: "2026-08", total: 24, detained: 6 }, { month: "2026-10", total: 4, detained: 1 }],
      "2026-11-03",
    )
    expect(points.map((p) => [p.month, p.total, p.rate.sufficient, p.partial])).toEqual([
      ["2026-08", 24, true, false],
      ["2026-09", 0, false, false],
      ["2026-10", 4, false, false],
      ["2026-11", 0, false, true],
    ])
  })

  it("la nota del tooltip dice la base o por qué falta", () => {
    const [full, empty, few] = shapePpaMonthly(
      [{ month: "2026-08", total: 24, detained: 6 }, { month: "2026-10", total: 4, detained: 1 }],
      "2026-10-20",
    )
    expect(ppaMonthNote(full!)).toBe("6 de 24 PPA detenidos")
    expect(ppaMonthNote(empty!)).toBe("Sin PPA en el mes")
    expect(ppaMonthNote(few!)).toBe("Datos insuficientes: 4 PPA, se necesitan al menos 20 para una tasa")
  })
})

describe("summarizePpaTrend", () => {
  const shape = (rows: Array<{ month: string; total: number; detained: number }>, today = "2026-11-03") => shapePpaMonthly(rows, today)

  it("sin PPA no dice nada", () => {
    expect(summarizePpaTrend(shape([]))).toBe("")
  })

  it("con pocos PPA no entrega una tasa: dice cuántos hay y que no alcanzan", () => {
    const text = summarizePpaTrend(shape([
      { month: "2026-07", total: 2, detained: 1 },
      { month: "2026-10", total: 3, detained: 0 },
    ]))
    expect(text).toBe("5 PPA entre julio y octubre, 1 detenido: datos insuficientes para una tasa de detención (se necesitan al menos 20).")
    expect(text).not.toMatch(/\d\s?%/)
  })

  it("con la base suficiente da la tasa con su n, nunca el porcentaje solo", () => {
    const text = summarizePpaTrend(shape([{ month: "2026-10", total: 22, detained: 6 }]))
    expect(text).toBe("6 de 22 PPA detenidos en octubre: tasa de detención de 27,3%.")
  })

  it("con los once PPA de hoy no da una tasa de detención: dice que son datos insuficientes", () => {
    const text = summarizePpaTrend(shape([{ month: "2026-10", total: 11, detained: 3 }]))
    expect(text).toBe("11 PPA en octubre, 3 detenidos: datos insuficientes para una tasa de detención (se necesitan al menos 20).")
    expect(text).not.toMatch(/\d\s?%/)
  })

  it("compara dos meses completos, contiguos y con base suficiente", () => {
    const text = summarizePpaTrend(shape([
      { month: "2026-08", total: 20, detained: 4 },
      { month: "2026-09", total: 20, detained: 6 },
    ], "2026-10-05"))
    expect(text).toContain("En septiembre fue de 30% (20 PPA), 10 puntos sobre agosto.")
  })

  it("no compara si un mes no tiene base suficiente", () => {
    const text = summarizePpaTrend(shape([
      { month: "2026-08", total: 20, detained: 4 },
      { month: "2026-09", total: 5, detained: 5 },
    ], "2026-10-05"))
    expect(text).not.toContain("sobre")
    expect(text).not.toContain("En septiembre fue")
  })

  it("el mes en curso no entra en la comparación", () => {
    const text = summarizePpaTrend(shape([
      { month: "2026-09", total: 20, detained: 4 },
      { month: "2026-10", total: 12, detained: 12 },
    ], "2026-10-05"))
    expect(text).not.toContain("En octubre fue")
  })
})

describe("ppaTrendDataTable", () => {
  it("escribe «Datos insuficientes» en vez de un porcentaje sobre una base chica", () => {
    const table = ppaTrendDataTable(shapePpaMonthly([{ month: "2026-09", total: 4, detained: 1 }], "2026-10-05"))
    expect(table.rows).toEqual([["Sep 2026", 4, 1, "Datos insuficientes"], ["Oct 2026 (en curso)", 0, 0, "—"]])
  })
})

describe("shapeWorksiteRanking", () => {
  it("ordena por tasa y no por conteo: la faena que más PPA llena no queda arriba por eso", () => {
    const ranking = shapeWorksiteRanking([
      { worksiteId: "a", worksiteName: "Faena A", total: 100, detained: 20 },
      { worksiteId: "b", worksiteName: "Faena B", total: 20, detained: 10 },
    ])
    // La A tiene el doble de detenidos pero una tasa menor: el ranking mide la tasa.
    expect(ranking.items.map((item) => [item.label, item.value, item.detail])).toEqual([
      ["Faena A", 20, "20 de 100 PPA detenidos"],
      ["Faena B", 50, "10 de 20 PPA detenidos"],
    ])
  })

  it("las faenas con pocos PPA no entran al ranking pero se nombran con su n", () => {
    const ranking = shapeWorksiteRanking([
      { worksiteId: "a", worksiteName: "Faena A", total: 24, detained: 2 },
      { worksiteId: "b", worksiteName: "Faena B", total: 1, detained: 1 },
      { worksiteId: "c", worksiteName: "Faena C", total: 3, detained: 0 },
      { worksiteId: "d", worksiteName: "Sin PPA", total: 0, detained: 0 },
    ])
    expect(ranking.items.map((item) => item.label)).toEqual(["Faena A"])
    expect(ranking.insufficient).toEqual([
      { key: "c", label: "Faena C", n: 3 },
      { key: "b", label: "Faena B", n: 1 },
    ])
  })
})

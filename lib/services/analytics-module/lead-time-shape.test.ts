import { describe, expect, it } from "vitest"
import {
  LEAD_TIME_MIN_SAMPLE,
  LEAD_TIME_P90_MIN_SAMPLE,
  buildSupplyLeadTime,
  leadTimeStageHeadline,
  summarizeDurations,
  type LeadTimeItem,
} from "./lead-time-shape"

describe("summarizeDurations", () => {
  it("con muestra suficiente da la mediana y, con muestra mayor, el P90 (interpolación lineal, como percentile_cont)", () => {
    const stat = summarizeDurations([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    expect(stat).toEqual({ n: 10, median: 5.5, p90: 9.1, insufficient: false })
  })

  it("con pocos ítems NO publica un número: «datos insuficientes», pero conserva el n", () => {
    const stat = summarizeDurations([3, 4, 5, 6])

    expect(LEAD_TIME_MIN_SAMPLE).toBe(5)
    expect(stat).toEqual({ n: 4, median: null, p90: null, insufficient: true })
  })

  it("justo en el mínimo ya hay mediana, pero el P90 de pocos datos es sólo el máximo y no se publica", () => {
    const stat = summarizeDurations([2, 2, 3, 9, 30])

    expect(stat.n).toBe(5)
    expect(stat.median).toBe(3)
    expect(stat.p90).toBeNull()
    expect(stat.insufficient).toBe(false)
    expect(LEAD_TIME_P90_MIN_SAMPLE).toBe(10)
  })

  it("sin observaciones: n = 0 e insuficiente", () => {
    expect(summarizeDurations([])).toEqual({ n: 0, median: null, p90: null, insufficient: true })
  })

  it("no depende del orden de entrada", () => {
    expect(summarizeDurations([9, 1, 5, 3, 7])).toEqual(summarizeDurations([1, 3, 5, 7, 9]))
  })
})

/** Día `d` desde 1970 (la base de las fechas del servicio). */
const D = 20_000

function item(id: string, over: Partial<LeadTimeItem> = {}): LeadTimeItem {
  return {
    worksiteId: "ws-a", worksiteName: "Faena A", requestType: "epp",
    submittedDay: D, approvedDay: D + 1, issuedDay: D + 3, arrivedDay: D + 9, deliveredDay: D + 10, closedDay: D + 10,
    ...over,
    // el id sólo ayuda a leer los fallos
    ...({ id } as object),
  }
}

const WINDOW = { current: [D, D + 30] as const, previous: [D - 31, D - 1] as const }

describe("buildSupplyLeadTime", () => {
  it("mide cada tramo entre sus dos hitos, con su propio n", () => {
    const items = Array.from({ length: 6 }, (_, i) => item(`i${i}`))
    const report = buildSupplyLeadTime(items, WINDOW)

    expect(report.overall.closedItems).toBe(6)
    expect(report.overall.stages.map((s) => [s.key, s.n, s.median])).toEqual([
      ["approval", 6, 1],
      ["purchase", 6, 2],
      ["arrival", 6, 6],
      ["delivery", 6, 1],
    ])
    expect(report.overall.total).toMatchObject({ n: 6, median: 10, insufficient: false })
  })

  it("un tramo sin los dos hitos no cuenta: el n de cada tramo puede ser distinto", () => {
    // 6 ítems; sólo 2 tienen entrega registrada (los demás cerraron con la llegada).
    const items = Array.from({ length: 6 }, (_, i) => item(`i${i}`, i < 2 ? {} : { deliveredDay: null, closedDay: D + 9 }))
    const report = buildSupplyLeadTime(items, WINDOW)

    const delivery = report.overall.stages.find((s) => s.key === "delivery")!
    expect(delivery).toMatchObject({ n: 2, median: null, insufficient: true })
    expect(report.overall.stages.find((s) => s.key === "arrival")!.n).toBe(6)
  })

  it("sólo cuentan los ítems cerrados en el período (por el día de cierre)", () => {
    const inside = Array.from({ length: 5 }, (_, i) => item(`in${i}`))
    const outside = item("fuera", { closedDay: D + 99 })
    const noClose = item("sin-cierre", { closedDay: null })
    const report = buildSupplyLeadTime([...inside, outside, noClose], WINDOW)

    expect(report.overall.closedItems).toBe(5)
  })

  it("las fechas fuera de orden se excluyen de la medición y se cuentan aparte, no se corrigen en silencio", () => {
    const ok = Array.from({ length: 5 }, (_, i) => item(`ok${i}`))
    // Se emitió la OC antes de aprobar: el tramo «Emisión de OC» tendría -2 días.
    const backwards = item("al-reves", { approvedDay: D + 5, issuedDay: D + 3 })
    const report = buildSupplyLeadTime([...ok, backwards], WINDOW)

    const purchase = report.overall.stages.find((s) => s.key === "purchase")!
    expect(purchase.n).toBe(5)
    expect(report.outOfOrder).toBe(1)
  })

  it("agrupa por faena, la que más ítems cierra primero, y cada faena trae su propio n", () => {
    const a = Array.from({ length: 5 }, (_, i) => item(`a${i}`))
    const b = Array.from({ length: 7 }, (_, i) => item(`b${i}`, { worksiteId: "ws-b", worksiteName: "Faena B" }))
    const report = buildSupplyLeadTime([...a, ...b], WINDOW)

    expect(report.byWorksite.map((g) => [g.label, g.closedItems])).toEqual([["Faena B", 7], ["Faena A", 5]])
    expect(report.overall.closedItems).toBe(12)
  })

  it("una faena con pocos ítems no publica número: la suma de pocos no se disfraza de dato", () => {
    const a = Array.from({ length: 3 }, (_, i) => item(`a${i}`))
    const report = buildSupplyLeadTime(a, WINDOW)

    expect(report.byWorksite[0]?.total).toEqual({ n: 3, median: null, p90: null, insufficient: true })
    expect(report.byWorksite[0]?.stages.every((s) => s.insufficient)).toBe(true)
  })

  it("el período anterior trae sólo el total (mediana y n) para comparar", () => {
    const now = Array.from({ length: 5 }, (_, i) => item(`n${i}`))
    const before = Array.from({ length: 6 }, (_, i) => item(`p${i}`, { submittedDay: D - 20, approvedDay: D - 19, issuedDay: D - 17, arrivedDay: D - 6, deliveredDay: D - 5, closedDay: D - 5 }))
    const report = buildSupplyLeadTime([...now, ...before], WINDOW)

    expect(report.previousTotal).toMatchObject({ n: 6, insufficient: false })
    expect(report.overall.closedItems).toBe(5)
  })

  it("sin ítems cerrados todo queda en n = 0 e insuficiente", () => {
    const report = buildSupplyLeadTime([], WINDOW)

    expect(report.overall.closedItems).toBe(0)
    expect(report.overall.total).toEqual({ n: 0, median: null, p90: null, insufficient: true })
    expect(report.byWorksite).toEqual([])
  })
})

describe("leadTimeStageHeadline", () => {
  const fmt = (value: number) => `${value} d`

  it("nombra el tramo más lento de la mediana, con el n del total", () => {
    const items = Array.from({ length: 6 }, (_, i) => item(`i${i}`))
    const report = buildSupplyLeadTime(items, WINDOW)

    expect(leadTimeStageHeadline(report, fmt)).toBe(
      "La mitad de los 6 ítems cerrados tardó 10 d o menos de la solicitud al cierre; el tramo más lento fue Llegada (6 d).",
    )
  })

  it("con datos insuficientes no entrega una cifra: dice cuántos ítems hay y cuántos faltan", () => {
    const report = buildSupplyLeadTime(Array.from({ length: 3 }, (_, i) => item(`i${i}`)), WINDOW)

    expect(leadTimeStageHeadline(report, fmt)).toBe("Datos insuficientes: hay 3 ítems cerrados en el período y se necesitan al menos 5 para publicar una mediana.")
  })

  it("sin ningún ítem cerrado lo dice sin hablar de «insuficiente»", () => {
    expect(leadTimeStageHeadline(buildSupplyLeadTime([], WINDOW), fmt)).toBe("Ningún ítem se cerró en el período.")
  })
})

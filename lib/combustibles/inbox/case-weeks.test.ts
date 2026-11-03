/**
 * Casos de anomalía por semana y gravedad (CHART-023b): la forma que recibe el
 * gráfico. Las semanas son lunes a domingo en hora de Chile; la semana en curso
 * siempre es parcial y no se compara con las completas.
 */
import { describe, expect, it } from "vitest"
import {
  ANOMALY_WEEKS_DEFAULT,
  anomalyWeekRangeLabel,
  anomalyWeekStarts,
  anomalyWeekTable,
  chileWeekStart,
  shapeAnomalyWeeks,
  summarizeAnomalyWeeks,
  visibleSeverities,
} from "./case-weeks"

// Martes 3 de noviembre de 2026, mediodía en Chile (UTC-3): la semana en curso parte el lunes 2.
const NOW = new Date("2026-11-03T15:00:00.000Z")

describe("chileWeekStart", () => {
  it("devuelve el lunes de la semana de una fecha sin hora, también si ya es lunes o es domingo", () => {
    expect(chileWeekStart("2026-11-03")).toBe("2026-11-02")
    expect(chileWeekStart("2026-11-02")).toBe("2026-11-02")
    expect(chileWeekStart("2026-11-08")).toBe("2026-11-02")
    expect(chileWeekStart("2026-11-09")).toBe("2026-11-09")
  })

  it("mide el día en hora de Chile, no en UTC: el domingo a las 23:30 chilenas sigue en esa semana", () => {
    // 02:30 UTC del lunes 2 de noviembre = domingo 1 a las 23:30 en Chile (UTC-3).
    expect(chileWeekStart(new Date("2026-11-02T02:30:00.000Z"))).toBe("2026-10-26")
    // Una hora después ya es lunes en Chile.
    expect(chileWeekStart(new Date("2026-11-02T03:30:00.000Z"))).toBe("2026-11-02")
  })

  it("cruza el fin de año sin perder días", () => {
    expect(chileWeekStart("2027-01-01")).toBe("2026-12-28")
  })
})

describe("anomalyWeekStarts", () => {
  it("lista los lunes de las últimas N semanas, de la más antigua a la en curso", () => {
    const starts = anomalyWeekStarts(NOW, 4)
    expect(starts).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"])
  })

  it("por omisión son doce semanas", () => {
    const starts = anomalyWeekStarts(NOW)
    expect(starts).toHaveLength(ANOMALY_WEEKS_DEFAULT)
    expect(starts[0]).toBe("2026-08-17")
    expect(starts.at(-1)).toBe("2026-11-02")
  })
})

describe("shapeAnomalyWeeks", () => {
  it("rellena con ceros las semanas sin casos y suma cada gravedad en su semana", () => {
    const weeks = shapeAnomalyWeeks(
      [
        { weekStart: "2026-10-19", severity: "high", count: 3 },
        { weekStart: "2026-10-19", severity: "low", count: 1 },
        { weekStart: "2026-11-02", severity: "medium", count: 2 },
      ],
      { now: NOW, weeks: 4 },
    )
    expect(weeks.map((week) => week.weekStart)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"])
    expect(weeks[0]).toMatchObject({ low: 0, medium: 0, high: 0, critical: 0, total: 0 })
    expect(weeks[1]).toMatchObject({ low: 1, medium: 0, high: 3, critical: 0, total: 4 })
    expect(weeks[2]!.total).toBe(0)
    expect(weeks[3]).toMatchObject({ medium: 2, total: 2 })
  })

  it("sólo la semana en curso es parcial", () => {
    const weeks = shapeAnomalyWeeks([], { now: NOW, weeks: 3 })
    expect(weeks.map((week) => week.partial)).toEqual([false, false, true])
  })

  it("ignora lo que cae fuera de la ventana o trae una gravedad desconocida, y junta filas repetidas de una misma semana", () => {
    const weeks = shapeAnomalyWeeks(
      [
        { weekStart: "2026-09-28", severity: "high", count: 9 },
        { weekStart: "2026-11-09", severity: "high", count: 9 },
        { weekStart: "2026-10-26", severity: "gravisima", count: 5 },
        { weekStart: "2026-10-26", severity: "critical", count: 1 },
        { weekStart: "2026-10-26", severity: "critical", count: 2 },
      ],
      { now: NOW, weeks: 3 },
    )
    expect(weeks.map((week) => week.total)).toEqual([0, 3, 0])
    expect(weeks[1]!.critical).toBe(3)
  })

  it("rotula cada semana con su lunes en texto corto", () => {
    const [first, , last] = shapeAnomalyWeeks([], { now: NOW, weeks: 3 })
    expect(first!.label).toBe("19 oct")
    expect(last!.label).toBe("2 nov")
  })
})

describe("anomalyWeekRangeLabel", () => {
  it("dice lunes y domingo, y repite el mes sólo cuando cambia", () => {
    expect(anomalyWeekRangeLabel("2026-10-26")).toBe("26 oct al 1 nov")
    expect(anomalyWeekRangeLabel("2026-11-02")).toBe("2 al 8 nov")
  })
})

describe("visibleSeverities", () => {
  it("sólo incluye las gravedades que aparecen en la ventana, de menor a mayor", () => {
    const weeks = shapeAnomalyWeeks(
      [
        { weekStart: "2026-10-26", severity: "high", count: 1 },
        { weekStart: "2026-11-02", severity: "low", count: 1 },
      ],
      { now: NOW, weeks: 3 },
    )
    expect(visibleSeverities(weeks)).toEqual(["low", "high"])
  })

  it("sin casos no hay ninguna", () => {
    expect(visibleSeverities(shapeAnomalyWeeks([], { now: NOW, weeks: 3 }))).toEqual([])
  })
})

describe("summarizeAnomalyWeeks", () => {
  const rows = [
    { weekStart: "2026-10-12", severity: "high", count: 2 },
    { weekStart: "2026-10-19", severity: "high", count: 5 },
    { weekStart: "2026-10-19", severity: "medium", count: 2 },
    { weekStart: "2026-10-26", severity: "low", count: 1 },
    { weekStart: "2026-11-02", severity: "medium", count: 3 },
  ]

  it("dice el total, la semana completa con más casos y lo que lleva la semana en curso", () => {
    const sentence = summarizeAnomalyWeeks(shapeAnomalyWeeks(rows, { now: NOW, weeks: 4 }))
    expect(sentence).toBe("13 casos detectados en las últimas 4 semanas. La semana con más fue la del 19 al 25 oct (7). Esta semana, que sigue en curso, lleva 3.")
  })

  it("en singular y sin pico cuando todo está en la semana en curso", () => {
    const sentence = summarizeAnomalyWeeks(shapeAnomalyWeeks([{ weekStart: "2026-11-02", severity: "low", count: 1 }], { now: NOW, weeks: 4 }))
    expect(sentence).toBe("1 caso detectado en las últimas 4 semanas. Esta semana, que sigue en curso, lleva 1.")
  })

  it("la semana en curso no compite por ser la más alta: sus pocos días no se comparan con semanas enteras", () => {
    const sentence = summarizeAnomalyWeeks(shapeAnomalyWeeks(
      [{ weekStart: "2026-10-26", severity: "low", count: 1 }, { weekStart: "2026-11-02", severity: "high", count: 8 }],
      { now: NOW, weeks: 4 },
    ))
    expect(sentence).toContain("La semana con más fue la del 26 oct al 1 nov (1)")
    expect(sentence).toContain("lleva 8")
  })

  it("con empate entre semanas completas nombra la más reciente", () => {
    const sentence = summarizeAnomalyWeeks(shapeAnomalyWeeks(
      [{ weekStart: "2026-10-12", severity: "low", count: 4 }, { weekStart: "2026-10-26", severity: "low", count: 4 }],
      { now: NOW, weeks: 4 },
    ))
    expect(sentence).toContain("la del 26 oct al 1 nov (4)")
  })

  it("sin ningún caso no hay frase: el gráfico explica el vacío", () => {
    expect(summarizeAnomalyWeeks(shapeAnomalyWeeks([], { now: NOW, weeks: 4 }))).toBeNull()
  })
})

describe("anomalyWeekTable", () => {
  it("arma «Ver datos» con la semana, las gravedades presentes y el total; la en curso lo dice", () => {
    const weeks = shapeAnomalyWeeks(
      [
        { weekStart: "2026-10-26", severity: "high", count: 2 },
        { weekStart: "2026-11-02", severity: "medium", count: 1 },
      ],
      { now: NOW, weeks: 2 },
    )
    expect(anomalyWeekTable(weeks)).toEqual({
      headers: ["Semana", "Media", "Alta", "Total"],
      rows: [
        ["26 oct al 1 nov", 0, 2, 2],
        ["2 al 8 nov (en curso)", 1, 0, 1],
      ],
    })
  })
})

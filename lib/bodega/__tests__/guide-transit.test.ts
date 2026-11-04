/**
 * CHART-037 · tiempo que tarda cada destino en confirmar las guías de despacho, y
 * antigüedad de las que siguen por confirmar.
 *
 * Módulo puro: la consulta trae, por destino, cuántas guías se confirmaron y su
 * mediana y P90 en días; aquí se decide qué se puede afirmar. La regla central es
 * la de la auditoría: una cifra lleva su n y con pocas guías no hay cifra.
 */
import { describe, expect, it } from "vitest"
import {
  GUIDE_AGE_BUCKETS,
  GUIDE_MIN_N,
  GUIDE_MIN_N_P90,
  bucketGuideAges,
  formatTransitDays,
  guideAgeHref,
  guideAgeSummary,
  guideDestinationHref,
  shapeGuideTransit,
  transitSummary,
  transitTable,
  transitWindowText,
  type GuideTransitRow,
} from "../guide-transit"

const row = (id: string, name: string, confirmed: number, median: number | null, p90: number | null, withDifferences = 0): GuideTransitRow => ({
  worksiteId: id, worksiteName: name, confirmed, median, p90, withDifferences,
})

describe("formatTransitDays", () => {
  it("menos de un día se dice con palabras, no como «0 d»", () => {
    expect(formatTransitDays(0.2)).toBe("menos de 1 día")
    expect(formatTransitDays(0)).toBe("menos de 1 día")
  })

  it("con un decimal bajo 10 días y entero desde ahí", () => {
    expect(formatTransitDays(1)).toBe("1 día")
    expect(formatTransitDays(1.5)).toBe("1,5 días")
    expect(formatTransitDays(9.94)).toBe("9,9 días")
    expect(formatTransitDays(12.4)).toBe("12 días")
  })

  it("un valor corrupto no inventa una cifra", () => {
    expect(formatTransitDays(Number.NaN)).toBe("—")
    expect(formatTransitDays(-3)).toBe("—")
  })
})

describe("shapeGuideTransit", () => {
  it("con pocas guías no hay cifra: datos insuficientes, con su n", () => {
    const shaped = shapeGuideTransit([row("a", "Cholguán", GUIDE_MIN_N - 1, 2, 4)])
    expect(shaped.destinations[0]).toMatchObject({ state: "insufficient", median: null, p90: null, confirmed: GUIDE_MIN_N - 1 })
  })

  it("con n suficiente para la mediana pero no para el P90, sólo la mediana", () => {
    const shaped = shapeGuideTransit([row("a", "Cholguán", GUIDE_MIN_N, 2, 6)])
    expect(shaped.destinations[0]).toMatchObject({ state: "median_only", median: 2, p90: null })
  })

  it("con n para el P90 trae las dos cifras", () => {
    const shaped = shapeGuideTransit([row("a", "Cholguán", GUIDE_MIN_N_P90, 2, 6)])
    expect(shaped.destinations[0]).toMatchObject({ state: "measured", median: 2, p90: 6 })
  })

  it("ordena lo medible de más lento a más rápido y deja al final lo que no tiene cifra", () => {
    const shaped = shapeGuideTransit([
      row("a", "Rápida", 12, 1, 2),
      row("b", "Pocas", 2, 9, 9),
      row("c", "Lenta", 12, 6, 14),
      row("d", "Media", 6, 3, 5),
    ])
    expect(shaped.destinations.map((destination) => destination.worksiteName)).toEqual(["Lenta", "Media", "Rápida", "Pocas"])
    expect(shaped.measured.map((destination) => destination.worksiteName)).toEqual(["Lenta", "Media", "Rápida"])
    expect(shaped.insufficient.map((destination) => destination.worksiteName)).toEqual(["Pocas"])
  })

  it("un destino sin mediana (todas con diferencias) es insuficiente aunque tenga guías", () => {
    const shaped = shapeGuideTransit([row("a", "Cholguán", 0, null, null, 4)])
    expect(shaped.destinations[0]).toMatchObject({ state: "insufficient", confirmed: 0, withDifferences: 4 })
  })

  it("cuenta las guías confirmadas y las que quedaron fuera por tener diferencias", () => {
    const shaped = shapeGuideTransit([row("a", "A", 8, 2, 5, 1), row("b", "B", 3, 1, 2, 2)])
    expect(shaped.confirmed).toBe(11)
    expect(shaped.withDifferences).toBe(3)
  })
})

describe("transitSummary", () => {
  const window = "En los últimos 6 meses"

  it("nombra al destino que más tarda entre los que se pueden comparar, con su n", () => {
    const shaped = shapeGuideTransit([row("a", "Rápida", 12, 1, 2), row("c", "Cholguán", 12, 6.2, 14)])
    expect(transitSummary(shaped, window)).toBe(
      "En los últimos 6 meses, Cholguán es el destino que más tarda en confirmar: mediana de 6,2 días entre 12 guías. El otro destino confirma en una mediana de 1 día o menos.",
    )
  })

  it("con tres destinos habla de «los otros»", () => {
    const shaped = shapeGuideTransit([row("a", "A", 12, 1, 2), row("b", "B", 12, 2, 3), row("c", "Cholguán", 12, 6, 14)])
    expect(transitSummary(shaped, window)).toContain("Los otros destinos confirman en una mediana de 2 días o menos.")
  })

  it("si dos destinos empatan arriba no corona a uno solo", () => {
    const shaped = shapeGuideTransit([row("a", "Norte", 12, 4, 8), row("c", "Sur", 12, 4.04, 9), row("d", "Centro", 12, 1, 2)])
    const text = transitSummary(shaped, window)!
    expect(text).toContain("En los últimos 6 meses, Sur y Norte son los destinos que más tardan en confirmar, con una mediana de 4 días")
    expect(text).not.toContain("es el destino que más tarda")
  })

  it("con un solo destino medible no compara", () => {
    const shaped = shapeGuideTransit([row("c", "Cholguán", 12, 6, 14), row("b", "Pocas", 2, 9, 9)])
    const text = transitSummary(shaped, window)!
    expect(text).toContain("En los últimos 6 meses, Cholguán confirma en una mediana de 6 días (12 guías).")
    expect(text).toContain("1 destino sin guías suficientes para medirlo")
    expect(text).not.toContain("más tarda")
  })

  it("si ninguno alcanza no da cifras: lo dice con el n total", () => {
    const shaped = shapeGuideTransit([row("a", "A", 2, 1, 1), row("b", "B", 1, 4, 4)])
    expect(transitSummary(shaped, window)).toBe(
      "Todavía no hay guías confirmadas suficientes para comparar destinos (3 guías en 2 destinos, se necesitan 5 por destino).",
    )
  })

  it("avisa de las confirmadas con diferencias, que no entran a la medición", () => {
    const shaped = shapeGuideTransit([row("a", "A", 12, 2, 4, 3), row("c", "C", 12, 5, 9)])
    expect(transitSummary(shaped, window)).toContain("3 guías confirmadas con diferencias no entran a la medición.")
  })

  it("sin ninguna guía confirmada no hay frase (el gráfico explica el vacío)", () => {
    expect(transitSummary(shapeGuideTransit([]), window)).toBeNull()
  })
})

describe("transitWindowText", () => {
  it("sin fechas elegidas es la ventana por defecto, en meses", () => {
    expect(transitWindowText({ from: "2026-05-01", months: 6 })).toBe("En los últimos 6 meses")
    expect(transitWindowText({ from: "2026-10-01", months: 1 })).toBe("En el último mes")
  })

  it("con fechas elegidas las nombra con el formato de la plataforma", () => {
    expect(transitWindowText({ from: "2026-05-01", to: "2026-11-03", chosen: true, months: 6 })).toBe("Entre el 01-05-2026 y el 03-11-2026")
    expect(transitWindowText({ from: "2026-05-01", chosen: true, months: 6 })).toBe("Desde el 01-05-2026")
    expect(transitWindowText({ to: "2026-11-03", chosen: true, from: "", months: 6 })).toBe("Hasta el 03-11-2026")
  })
})

describe("transitTable y enlaces", () => {
  const shaped = shapeGuideTransit([row("a", "Cholguán", 12, 2, 5, 1), row("b", "Pocas", 2, 9, 9)])

  it("«Ver datos» muestra n y, donde no alcanza, «datos insuficientes» en lugar de la cifra", () => {
    const table = transitTable(shaped)
    expect(table.headers).toEqual(["Destino", "Guías medidas", "Mediana", "P90", "Con diferencias (no medidas)"])
    expect(table.rows).toEqual([
      ["Cholguán", 12, "2 días", "5 días", 1],
      ["Pocas", 2, "Datos insuficientes", "Datos insuficientes", 0],
    ])
  })

  it("con n entre 5 y 9 el P90 dice cuántas guías le faltan", () => {
    const mid = shapeGuideTransit([row("a", "Media", 6, 2, 4)])
    expect(transitTable(mid).rows[0]).toEqual(["Media", 6, "2 días", "Datos insuficientes (desde 10 guías)", 0])
  })

  it("un destino lleva a las guías recibidas de esa faena en la misma ventana", () => {
    expect(guideDestinationHref("ws-1", "2026-05-01", "2026-11-03")).toBe("/bodega/guias?estado=received&faena=ws-1&desde=2026-05-01&hasta=2026-11-03")
    expect(guideDestinationHref("ws-1", "2026-05-01")).toBe("/bodega/guias?estado=received&faena=ws-1&desde=2026-05-01")
  })
})

describe("bucketGuideAges y guideAgeSummary", () => {
  it("usa la misma escala de espera que la cola de aprobaciones: 0–1, 2–3, 4–7 y más de 7 días", () => {
    expect(GUIDE_AGE_BUCKETS.map((bucket) => bucket.key)).toEqual(["0-1", "2-3", "4-7", "mas-de-7"])
  })

  it("reparte por días civiles y no cuenta lo que no tiene fecha de salida", () => {
    const counts = bucketGuideAges([
      { ageDays: 0, guides: 2 }, { ageDays: 3, guides: 1 }, { ageDays: 7, guides: 1 }, { ageDays: 12, guides: 4 }, { ageDays: null, guides: 5 },
    ])
    expect(counts).toEqual({ "0-1": 2, "2-3": 1, "4-7": 1, "mas-de-7": 4 })
  })

  it("responde cuántas esperan y cuántas llevan más de una semana", () => {
    expect(guideAgeSummary({ "0-1": 2, "2-3": 1, "4-7": 1, "mas-de-7": 4 }, "")).toBe("8 guías despachadas esperan confirmación; 4 llevan más de 7 días.")
    expect(guideAgeSummary({ "0-1": 1, "2-3": 0, "4-7": 0, "mas-de-7": 0 }, "")).toBe("1 guía despachada espera confirmación; ninguna lleva más de 7 días.")
  })

  it("con un tramo elegido dice qué parte del total muestra la lista", () => {
    expect(guideAgeSummary({ "0-1": 2, "2-3": 1, "4-7": 1, "mas-de-7": 4 }, "mas-de-7")).toBe("Filtrando por «Más de 7 días»: 4 de 8 guías.")
  })

  it("sin ninguna no hay frase", () => {
    expect(guideAgeSummary({ "0-1": 0, "2-3": 0, "4-7": 0, "mas-de-7": 0 }, "")).toBeNull()
  })

  it("el enlace de un tramo lleva a las despachadas de esa faena y descarta fechas, búsqueda y página", () => {
    expect(guideAgeHref("mas-de-7", "ws-1")).toBe("/bodega/guias?estado=dispatched&faena=ws-1&antiguedad=mas-de-7")
    expect(guideAgeHref("mas-de-7", "")).toBe("/bodega/guias?estado=dispatched&faena=todas&antiguedad=mas-de-7")
    // La salida del filtro deja la lista de las despachadas de esa faena.
    expect(guideAgeHref("", "ws-1")).toBe("/bodega/guias?estado=dispatched&faena=ws-1")
  })
})

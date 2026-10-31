import { describe, expect, it } from "vitest"
import { describeFuelPeriod } from "@/lib/combustibles/period/parse"
import { buildPanelFigures, variationLabel, variationSentence, type PanelFigureBucket, type PanelFiguresRaw } from "./figures"

const TODAY = "2026-10-31"

function bucket(partial: Partial<PanelFigureBucket> = {}): PanelFigureBucket {
  return {
    from: "2026-01-01", to: "2026-01-31",
    liters: 0, loads: 0, equipment: 0,
    truckKm: 0, truckLiters: 0, truckExcluded: 0,
    machineHours: 0, machineLiters: 0, machineExcluded: 0,
    ...partial,
  }
}

const monthPeriod = (year: number, month: number) => describeFuelPeriod({ kind: "month", year, month }, "url", TODAY)

describe("las tres cifras del período", () => {
  it("arma litros, km/L y L/h de un mes cerrado, con la variación contra el anterior", () => {
    const raw: PanelFiguresRaw = {
      partialPrevLiters: null,
      buckets: [
        bucket({ liters: 43_000, loads: 100, equipment: 100, truckKm: 5_200, truckLiters: 2_000 }),
        bucket({ liters: 44_000, loads: 110, equipment: 110, truckKm: 5_400, truckLiters: 2_000 }),
        bucket({ liters: 47_000, loads: 120, equipment: 112, truckKm: 5_600, truckLiters: 2_000 }),
        bucket({ liters: 50_800, loads: 130, equipment: 117, truckKm: 5_800, truckLiters: 2_000, machineHours: 100, machineLiters: 1_380 }),
        bucket({ liters: 49_900, loads: 125, equipment: 121, truckKm: 5_600, truckLiters: 2_000, truckExcluded: 4, machineHours: 100, machineLiters: 1_350, machineExcluded: 1 }),
      ],
    }
    const figures = buildPanelFigures(raw, monthPeriod(2026, 9), TODAY)

    expect(figures.liters.label).toBe("Litros cargados a 121 equipos")
    expect(figures.liters.value).toBe("49.900")
    expect(figures.liters.variation).toEqual({ pct: -2, polarity: "neutral", versus: "agosto", partialDays: null })
    expect(figures.liters.hint).toBeNull()
    expect(figures.liters.history.map((point) => point.label)).toEqual(["may", "jun", "jul", "ago", "sep"])
    expect(figures.liters.history[4]?.fullLabel).toBe("Septiembre 2026")

    // km/L = Σkm ÷ Σlitros: 5.600 ÷ 2.000 = 2,8 (y 5.800 ÷ 2.000 = 2,9 el mes anterior).
    expect(figures.trucks.value).toBe("2,8")
    expect(figures.trucks.variation).toEqual({ pct: -3, polarity: "up-good", versus: "agosto", partialDays: null })
    expect(figures.trucks.hint).toBe("4 cargas por decidir no entran al promedio")
    expect(figures.trucks.unit).toBe("km/L")

    // L/h = Σlitros ÷ Σhoras: 1.350 ÷ 100 = 13,5 (menos es mejor: la baja es buena noticia).
    expect(figures.machinery.value).toBe("13,5")
    expect(figures.machinery.variation).toEqual({ pct: -2, polarity: "up-bad", versus: "agosto", partialDays: null })
    expect(figures.machinery.hint).toBe("1 carga por decidir no entra al promedio")
    expect(figures.machinery.history.map((point) => point.value)).toEqual([null, null, null, 13.8, 13.5])
    expect(figures.empty).toBe(false)
  })

  it("no inventa un cero: sin cargas ni medidor la cifra queda sin dato", () => {
    const raw: PanelFiguresRaw = { partialPrevLiters: null, buckets: Array.from({ length: 5 }, () => bucket()) }
    const figures = buildPanelFigures(raw, monthPeriod(2026, 9), TODAY)
    expect(figures.empty).toBe(true)
    expect(figures.liters.value).toBeNull()
    expect(figures.liters.label).toBe("Litros cargados")
    expect(figures.trucks.value).toBeNull()
    expect(figures.machinery.value).toBeNull()
    expect(figures.liters.variation).toBeNull()
    expect(figures.trucks.history.every((point) => point.value === null)).toBe(true)
  })

  it("sin período anterior con datos no hay variación que mostrar", () => {
    const raw: PanelFiguresRaw = {
      partialPrevLiters: null,
      buckets: [bucket(), bucket(), bucket(), bucket(), bucket({ liters: 900, loads: 4, equipment: 2, truckKm: 100, truckLiters: 50 })],
    }
    const figures = buildPanelFigures(raw, monthPeriod(2026, 9), TODAY)
    expect(figures.liters.value).toBe("900")
    expect(figures.liters.variation).toBeNull()
    expect(figures.trucks.value).toBe("2")
    expect(figures.trucks.variation).toBeNull()
  })

  it("un período en curso se compara contra los mismos primeros días del anterior, no contra el mes entero", () => {
    const raw: PanelFiguresRaw = {
      partialPrevLiters: 15_000,
      buckets: [
        bucket(), bucket(), bucket(),
        bucket({ liters: 49_900, loads: 125, equipment: 121 }),
        bucket({ liters: 16_500, loads: 40, equipment: 60 }),
      ],
    }
    // Hoy es el 31 de octubre: el mes lleva los 31 días, pero la regla vale con cualquier avance.
    const figures = buildPanelFigures(raw, monthPeriod(2026, 10), TODAY)
    expect(figures.liters.variation).toEqual({ pct: 10, polarity: "neutral", versus: "septiembre", partialDays: 31 })
    expect(figures.liters.hint).toBe("Lleva 31 de 31 días del período.")

    // A mitad de mes, contra los mismos 14 días (y no contra los 49.900 L del mes anterior completo).
    const mid = buildPanelFigures(raw, monthPeriod(2026, 10), "2026-10-14")
    expect(mid.liters.variation?.partialDays).toBe(14)
    expect(mid.liters.hint).toBe("Lleva 14 de 31 días del período.")
  })

  it("un período en curso sin referencia en el anterior no muestra variación", () => {
    const raw: PanelFiguresRaw = {
      partialPrevLiters: 0,
      buckets: [bucket(), bucket(), bucket(), bucket({ liters: 100, loads: 1, equipment: 1 }), bucket({ liters: 50, loads: 1, equipment: 1 })],
    }
    expect(buildPanelFigures(raw, monthPeriod(2026, 10), TODAY).liters.variation).toBeNull()
  })

  it("las semanas rotulan cada barra con el lunes que la abre", () => {
    const period = describeFuelPeriod({ kind: "week", year: 2026, week: 44 }, "url", TODAY)
    const raw: PanelFiguresRaw = { partialPrevLiters: null, buckets: Array.from({ length: 5 }, () => bucket({ liters: 10, loads: 1, equipment: 1 })) }
    const figures = buildPanelFigures(raw, period, TODAY)
    expect(figures.liters.history.map((point) => point.label)).toEqual(["28 sep", "5 oct", "12 oct", "19 oct", "26 oct"])
  })
})

describe("la variación en palabras", () => {
  it("rotula la comparación y la dice dentro de una frase", () => {
    const down = { pct: -4, polarity: "neutral" as const, versus: "septiembre", partialDays: null }
    expect(variationLabel(down)).toBe("vs. septiembre")
    expect(variationSentence(down)).toBe("4 % menos que en septiembre")
    expect(variationSentence({ ...down, pct: 2, versus: "la semana del 19 de octubre" })).toBe("2 % más que en la semana del 19 de octubre")
    expect(variationSentence({ ...down, pct: 0 })).toBe("igual que en septiembre")
  })

  it("compara los mismos días cuando el período sigue en curso", () => {
    const partial = { pct: 6, polarity: "neutral" as const, versus: "septiembre", partialDays: 14 }
    expect(variationLabel(partial)).toBe("vs. los mismos 14 días de septiembre")
    expect(variationSentence(partial)).toBe("6 % más que en los mismos 14 días de septiembre")
    expect(variationLabel({ ...partial, partialDays: 1 })).toBe("vs. el mismo día de septiembre")
  })
})

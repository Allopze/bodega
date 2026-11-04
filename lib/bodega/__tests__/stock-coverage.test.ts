/**
 * CHART-035a · cobertura de stock en días.
 *
 * Módulo puro: la consulta trae cuánto salió y cuántas veces; aquí se decide qué
 * significa. Los casos de borde son los de la auditoría: un producto sin
 * consumo (nunca ∞), uno nuevo sin historia y una demanda irregular con pocas
 * salidas, que no deben dar una cifra con aire de certeza.
 */
import { describe, expect, it } from "vitest"
import {
  COVERAGE_BAND_ORDER,
  computeCoverage,
  coverageBarFraction,
  coverageBandColor,
  coverageSummary,
  formatCoverageDays,
  parseCoverageParam,
  summarizeCoverage,
  type CoverageBand,
} from "../stock-coverage"

const steady = { events: 12, historyDays: 200 }

describe("computeCoverage", () => {
  it("días = stock / (consumo de 90 días / 90)", () => {
    // 90 unidades en 90 días = 1 por día: 45 de stock alcanzan para 45 días.
    expect(computeCoverage({ quantity: 45, consumed: 90, ...steady })).toMatchObject({ band: "gt30", days: 45, dailyRate: 1 })
  })

  it("las bandas cortan en 7 y en 30 días, sobre el valor que se muestra", () => {
    const at = (quantity: number) => computeCoverage({ quantity, consumed: 90, ...steady }).band
    expect(at(6)).toBe("lt7")
    expect(at(6.9)).toBe("lt7")
    expect(at(7)).toBe("d7_30")
    expect(at(30)).toBe("d7_30")
    // 30,5 días se muestra «30 d»: no puede caer en «más de 30».
    expect(at(30.5)).toBe("d7_30")
    expect(at(31)).toBe("gt30")
  })

  it("sin ninguna salida es «sin consumo», nunca infinito", () => {
    const coverage = computeCoverage({ quantity: 500, consumed: 0, events: 0, historyDays: 200 })
    expect(coverage).toMatchObject({ band: "none", days: null, dailyRate: null })
  })

  it("el reverso de una entrega anulada puede dejar el consumo neto en cero: sigue siendo sin consumo", () => {
    expect(computeCoverage({ quantity: 10, consumed: 0, events: 2, historyDays: 200 }).band).toBe("none")
  })

  it("con pocas salidas no se afirma una cifra: datos insuficientes, con su n", () => {
    const coverage = computeCoverage({ quantity: 10, consumed: 4, events: 2, historyDays: 200 })
    expect(coverage).toMatchObject({ band: "insufficient", days: null, events: 2 })
  })

  it("un producto nuevo (menos de 30 días en la faena) no tiene historia para estimar", () => {
    expect(computeCoverage({ quantity: 10, consumed: 40, events: 8, historyDays: 12 }).band).toBe("insufficient")
    expect(computeCoverage({ quantity: 10, consumed: 40, events: 8, historyDays: null }).band).toBe("insufficient")
  })

  it("con historia corta pero suficiente el ritmo se mide sobre los días que lleva, no sobre 90", () => {
    // 60 unidades en 30 días = 2 por día; 20 de stock = 10 días (no 30).
    expect(computeCoverage({ quantity: 20, consumed: 60, events: 6, historyDays: 30 })).toMatchObject({ band: "d7_30", days: 10, windowDays: 30 })
  })

  it("agotado con consumo es 0 días, el peor caso y no «sin dato»", () => {
    expect(computeCoverage({ quantity: 0, consumed: 30, ...steady })).toMatchObject({ band: "lt7", days: 0 })
  })

  it("ignora cantidades corruptas en vez de propagar NaN", () => {
    expect(computeCoverage({ quantity: Number.NaN, consumed: 30, ...steady }).band).toBe("insufficient")
    expect(computeCoverage({ quantity: 5, consumed: Number.NaN, events: 3, historyDays: 100 }).band).toBe("none")
  })
})

describe("formatCoverageDays y barra", () => {
  it("redondea hacia abajo para no prometer de más", () => {
    expect(formatCoverageDays(6.9)).toBe("6 d")
    expect(formatCoverageDays(0.4)).toBe("menos de 1 d")
    expect(formatCoverageDays(0)).toBe("0 d")
    expect(formatCoverageDays(400)).toBe("más de 365 d")
  })

  it("la barra llena a los 60 días y no pasa de ahí", () => {
    expect(coverageBarFraction(0)).toBe(0)
    expect(coverageBarFraction(30)).toBe(0.5)
    expect(coverageBarFraction(60)).toBe(1)
    expect(coverageBarFraction(500)).toBe(1)
  })
})

describe("summarizeCoverage y la frase", () => {
  const bands = (list: CoverageBand[]) => summarizeCoverage(list)

  it("cuenta cada banda en el orden del dominio", () => {
    const counts = bands(["lt7", "lt7", "gt30", "none", "insufficient", "d7_30"])
    expect(COVERAGE_BAND_ORDER.map((band) => counts.byBand[band])).toEqual([2, 1, 1, 1, 1])
    expect(counts.total).toBe(6)
    expect(counts.measured).toBe(4)
  })

  it("responde cuántos alcanzan para menos de 7 días", () => {
    const counts = bands(["lt7", "lt7", "gt30", "none"])
    expect(coverageSummary(counts, "producto")).toBe(
      "Con el consumo de los últimos 90 días, 2 de 4 productos alcanzan para menos de 7 días. 1 sin consumo.",
    )
  })

  it("en singular concuerda", () => {
    expect(coverageSummary(bands(["lt7"]), "producto")).toBe(
      "Con el consumo de los últimos 90 días, el único producto alcanza para menos de 7 días.",
    )
  })

  it("si nadie está bajo 7 días lo dice, sin inventar urgencia", () => {
    const text = coverageSummary(bands(["gt30", "gt30", "d7_30"]), "producto")
    expect(text).toContain("Ninguno de los 3 productos alcanza para menos de 7 días")
  })

  it("cuando no hay nada medible lo dice y no da una cifra", () => {
    const text = coverageSummary(bands(["none", "insufficient", "insufficient"]), "producto")
    expect(text).toContain("Todavía no hay consumo suficiente para estimar")
    expect(text).toContain("2 con datos insuficientes")
    expect(text).toContain("1 sin consumo")
    expect(text).not.toContain("alcanzan para")
  })

  it("sin ninguna línea no hay frase (el gráfico explica el vacío)", () => {
    expect(coverageSummary(bands([]), "producto")).toBeNull()
  })
})

describe("parseCoverageParam y color", () => {
  it("sólo pasan las claves de banda", () => {
    expect(parseCoverageParam("lt7")).toBe("lt7")
    expect(parseCoverageParam(["gt30", "lt7"])).toBe("gt30")
    expect(parseCoverageParam("DROP TABLE")).toBe("")
    expect(parseCoverageParam(undefined)).toBe("")
  })

  it("las bandas vecinas no comparten color", () => {
    const colors = COVERAGE_BAND_ORDER.map((band) => coverageBandColor(band))
    colors.slice(1).forEach((color, index) => expect(color).not.toBe(colors[index]))
    expect(colors.every((color) => color.startsWith("var(--color-"))).toBe(true)
  })
})

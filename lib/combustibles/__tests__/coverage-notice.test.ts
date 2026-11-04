import { describe, expect, it } from "vitest"
import { coverageMonthsOf, coverageNoticeText, formatCoverageMonth, formatCoverageMonths, fuelSourcesHref } from "../coverage-notice"

/**
 * El aviso de cobertura de los gráficos de combustible: una sola redacción para la pantalla
 * (`CoverageNotice`) y para la hoja «Metadatos» de las exportaciones. Cada frase tiene que ser
 * cierta también en los bordes: un mes, varios, parcial, hueco y parcial a la vez.
 */
describe("coverageNoticeText", () => {
  const subject = "los totales de 12 meses"

  it("un mes sin datos: lo nombra y dice qué cifras no lo incluyen", () => {
    expect(coverageNoticeText({ gapMonths: ["2026-09"], subject })).toBe("Sin datos del proveedor en sep-2026: los totales de 12 meses no incluyen ese mes.")
  })

  it("varios meses: los lista con «y» y habla en plural", () => {
    expect(coverageNoticeText({ gapMonths: ["2025-11", "2025-12", "2026-09"], subject })).toBe(
      "Sin datos del proveedor en nov-2025, dic-2025 y sep-2026: los totales de 12 meses no incluyen esos meses.",
    )
  })

  it("ordena los meses y no repite uno, aunque el llamador los entregue desordenados o duplicados", () => {
    expect(coverageNoticeText({ gapMonths: ["2026-09", "2025-11", "2026-09"], subject })).toBe(
      "Sin datos del proveedor en nov-2025 y sep-2026: los totales de 12 meses no incluyen esos meses.",
    )
  })

  it("un mes parcial se dice aparte y no como hueco", () => {
    expect(coverageNoticeText({ gapMonths: [], partialMonths: ["2026-11"], subject })).toBe("El mes de nov-2026 todavía no está completo.")
    expect(coverageNoticeText({ gapMonths: [], partialMonths: ["2026-10", "2026-11"], subject })).toBe("Los meses de oct-2026 y nov-2026 todavía no están completos.")
  })

  it("hueco y parcial conviven en dos oraciones", () => {
    expect(coverageNoticeText({ gapMonths: ["2026-09"], partialMonths: ["2026-11"], subject })).toBe(
      "Sin datos del proveedor en sep-2026: los totales de 12 meses no incluyen ese mes. El mes de nov-2026 todavía no está completo.",
    )
  })

  it("un mes que es hueco y parcial a la vez se dice una sola vez, como hueco", () => {
    // El mes en curso sin ninguna transacción: es un hueco, no «un mes incompleto con datos».
    expect(coverageNoticeText({ gapMonths: ["2026-11"], partialMonths: ["2026-11"], subject })).toBe(
      "Sin datos del proveedor en nov-2026: los totales de 12 meses no incluyen ese mes.",
    )
  })

  it("sin meses que advertir no hay aviso", () => {
    expect(coverageNoticeText({ gapMonths: [], subject })).toBeNull()
    expect(coverageNoticeText({ gapMonths: [], partialMonths: [], subject })).toBeNull()
  })

  it("la fuente y las cifras salen del llamador: no afirma nada que la pantalla no muestre", () => {
    expect(coverageNoticeText({ gapMonths: ["2026-09"], subject: "las horas de la telemetría", source: "de la telemetría" })).toBe(
      "Sin datos de la telemetría en sep-2026: las horas de la telemetría no incluyen ese mes.",
    )
  })
})

describe("coverageMonthsOf", () => {
  it("el hueco manda sobre el parcial y los dos salen en orden", () => {
    expect(coverageMonthsOf({ gapMonths: ["2026-09", "2026-08"], partialMonths: ["2026-11", "2026-09"] })).toEqual({
      gaps: ["2026-08", "2026-09"],
      partial: ["2026-11"],
    })
  })
})

describe("formatCoverageMonth(s)", () => {
  it("rotula como el resto de la plataforma: sep-2026", () => {
    expect(formatCoverageMonth("2026-09")).toBe("sep-2026")
    expect(formatCoverageMonths(["2025-11", "2025-12", "2026-09"])).toBe("nov-2025, dic-2025 y sep-2026")
    expect(formatCoverageMonths([])).toBe("")
  })

  it("una clave que no es un mes se devuelve tal cual en vez de inventar un rótulo", () => {
    expect(formatCoverageMonth("septiembre")).toBe("septiembre")
    expect(formatCoverageMonth("2026-13")).toBe("2026-13")
  })
})

describe("fuelSourcesHref", () => {
  const session = (permissions: string[]) => ({ user: { permissions } })

  it("ofrece el enlace sólo a quien puede abrir «Fuentes de datos»", () => {
    expect(fuelSourcesHref(session(["combustibles:import"]))).toBe("/combustibles/fuentes")
    expect(fuelSourcesHref(session(["combustibles:tae_import"]))).toBe("/combustibles/fuentes")
    expect(fuelSourcesHref(session(["combustibles:sync_integrations"]))).toBe("/combustibles/fuentes")
  })

  it("quien sólo ve combustible no recibe un enlace que termina en /forbidden", () => {
    expect(fuelSourcesHref(session(["combustibles:view", "combustibles:export"]))).toBeUndefined()
    expect(fuelSourcesHref(null)).toBeUndefined()
    expect(fuelSourcesHref({ user: null })).toBeUndefined()
  })
})

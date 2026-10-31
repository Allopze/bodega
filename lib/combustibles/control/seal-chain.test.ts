import { describe, expect, it } from "vitest"
import { evaluateSealChain, reevaluateNextSealChain } from "./seal-chain"
import { isFillerDate, isFillerSealNumber, normalizeSeal } from "./validation"

const seals = (removedSeal: string | null, installedSeal: string | null, noSealReason: string | null = null) =>
  ({ removedSeal, installedSeal, noSealReason })

describe("evaluateSealChain", () => {
  it("ok: retira el sello instalado en la carga anterior", () => {
    expect(evaluateSealChain(seals("0504", "0507"), "0504")).toEqual({ status: "ok", expected: null })
  })

  it("ok aunque la planilla escriba el sello sin ceros a la izquierda o con espacios", () => {
    expect(evaluateSealChain(seals(" 504 ", "507"), "0504").status).toBe("ok")
  })

  it("mismatch: retira un sello distinto del esperado", () => {
    expect(evaluateSealChain(seals("0999", "0507"), "0504")).toEqual({ status: "mismatch", expected: "0504" })
  })

  it("mismatch: empezó sin romper el sello que esperaba", () => {
    expect(evaluateSealChain(seals(null, "0507"), "0504")).toEqual({ status: "mismatch", expected: "0504" })
  })

  it("no_previous: primera carga del equipo con sello", () => {
    expect(evaluateSealChain(seals("0504", "0507"), undefined)).toEqual({ status: "no_previous", expected: null })
  })

  it("no_seal: sin sellos y con motivo", () => {
    expect(evaluateSealChain(seals(null, null, "Equipo sin tapa sellable"), "0504")).toEqual({ status: "no_seal", expected: null })
  })

  it("la carga anterior sin sello instalado no exige nada", () => {
    expect(evaluateSealChain(seals("0504", "0507"), null).status).toBe("ok")
  })
})

describe("valores de relleno", () => {
  it.each(["777777", "666666", "000000", "0", "00000", " 77777 "])("%s es sello de relleno", (value) => {
    expect(isFillerSealNumber(value)).toBe(true)
  })

  it.each(["0504", "7777", "123456", "770777", "A77777"])("%s no es sello de relleno", (value) => {
    expect(isFillerSealNumber(value)).toBe(false)
  })

  it("1899-12-30 (cero serial de Excel) y años previos a 1990 son fecha de relleno", () => {
    expect(isFillerDate("1899-12-30")).toBe(true)
    expect(isFillerDate("1989-12-31")).toBe(true)
    expect(isFillerDate("no-es-fecha")).toBe(true)
    expect(isFillerDate("2026-01-15")).toBe(false)
    expect(isFillerDate("1990-01-01")).toBe(false)
  })

  it("normalizeSeal: mayúsculas, sin espacios ni ceros a la izquierda", () => {
    expect(normalizeSeal(" a 0504 ")).toBe("A0504")
    expect(normalizeSeal("0504")).toBe("504")
    expect(normalizeSeal("0000")).toBe("0")
    expect(normalizeSeal("   ")).toBeNull()
    expect(normalizeSeal(null)).toBeNull()
  })
})

describe("reevaluateNextSealChain", () => {
  const next = (overrides: Partial<Parameters<typeof reevaluateNextSealChain>[0]> = {}) => ({
    removedSeal: "0507",
    installedSeal: "0510",
    noSealReason: null,
    sealChainStatus: "ok",
    sealChainExpected: null,
    ...overrides,
  })

  it("sin cambios cuando la carga intercalada instaló el mismo sello que esperaba la siguiente", () => {
    expect(reevaluateNextSealChain(next(), "0507")).toEqual({ changed: false, status: "ok", expected: null })
  })

  it("una carga intercalada con otro sello instalado rompe la cadena de la siguiente", () => {
    expect(reevaluateNextSealChain(next(), "0600")).toEqual({ changed: true, status: "mismatch", expected: "0600" })
  })

  it("repara la cadena cuando la intercalada completa el eslabón que faltaba", () => {
    const broken = next({ sealChainStatus: "mismatch", sealChainExpected: "0504" })
    expect(reevaluateNextSealChain(broken, "0507")).toEqual({ changed: true, status: "ok", expected: null })
  })

  it("una siguiente sin sellos y con motivo sigue en no_seal sin marcar cambio", () => {
    const none = next({ removedSeal: null, installedSeal: null, noSealReason: "Sin tapa sellable", sealChainStatus: "no_seal" })
    expect(reevaluateNextSealChain(none, "0507")).toEqual({ changed: false, status: "no_seal", expected: null })
  })

  it("si la intercalada no instaló sello, la siguiente no tiene qué esperar", () => {
    expect(reevaluateNextSealChain(next(), null)).toEqual({ changed: false, status: "ok", expected: null })
  })
})

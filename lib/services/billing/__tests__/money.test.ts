import { describe, it, expect } from "vitest"
import {
  addAmounts,
  subtractAmounts,
  sumAmounts,
  multiplyAmount,
  applyTaxRate,
  compareAmounts,
  amountsEqual,
  amountsWithinTolerance,
  absAmount,
  isZero,
  roundAmount,
  toMinorUnits,
  fromMinorUnits,
  assertSameCurrency,
  sumByCurrency,
  formatMoney,
  CurrencyMismatchError,
} from "../money"

describe("money — aritmética exacta", () => {
  it("suma sin arrastrar el error del punto flotante", () => {
    // El caso canónico: 0.1 + 0.2 en float da 0.30000000000000004.
    expect(addAmounts(0.1, 0.2)).toBe(0.3)
    expect(0.1 + 0.2).not.toBe(0.3)
  })

  it("suma una lista larga de decimales sin deriva", () => {
    const amounts = Array.from({ length: 100 }, () => 0.07)
    expect(sumAmounts(amounts)).toBe(7)
  })

  it("resta exactamente", () => {
    expect(subtractAmounts(1190000, 1000000)).toBe(190000)
    expect(subtractAmounts(0.3, 0.1)).toBe(0.2)
  })

  it("multiplica precio unitario por cantidad con 4 decimales", () => {
    expect(multiplyAmount(1500, 3)).toBe(4500)
    expect(multiplyAmount(1000, 0.3333)).toBe(333.3)
    expect(multiplyAmount(99.99, 3)).toBe(299.97)
  })

  it("aplica el IVA sobre el neto", () => {
    expect(applyTaxRate(1000000, 0.19)).toBe(190000)
    // Redondeo al centavo, no truncado.
    expect(applyTaxRate(105, 0.19)).toBe(19.95)
  })

  it("compara a la escala del esquema", () => {
    expect(compareAmounts(10, 10.001)).toBe(0)   // por debajo de un centavo
    expect(compareAmounts(10, 10.01)).toBe(-1)
    expect(compareAmounts(10.01, 10)).toBe(1)
    expect(amountsEqual(0.1 + 0.2, 0.3)).toBe(true)
  })

  it("respeta la tolerancia de conciliación", () => {
    expect(amountsWithinTolerance(1190000, 1189999, 1)).toBe(true)
    expect(amountsWithinTolerance(1190000, 1189000, 1)).toBe(false)
    // Tolerancia negativa se toma en valor absoluto.
    expect(amountsWithinTolerance(100, 99, -1)).toBe(true)
  })

  it("maneja montos negativos (notas de crédito)", () => {
    expect(addAmounts(1190000, -1190000)).toBe(0)
    expect(isZero(addAmounts(1190000, -1190000))).toBe(true)
    expect(absAmount(-1190000)).toBe(1190000)
  })

  it("redondea a 2 decimales", () => {
    expect(roundAmount(1.006)).toBe(1.01)
    expect(roundAmount(1.004)).toBe(1)
    expect(roundAmount(1.0149)).toBe(1.01)
    // Límite real del doble, no del redondeo: el literal 1.005 vale
    // 1.00499999999999989 antes de entrar a la función, así que redondea a la
    // baja. Es la razón por la que los montos entran desde numeric(14,2) o
    // desde entrada validada, nunca desde un cálculo en coma flotante previo.
    expect(roundAmount(1.005)).toBe(1)
  })

  it("convierte a unidades menores y vuelve sin pérdida", () => {
    expect(toMinorUnits(1190000)).toBe(119000000)
    expect(fromMinorUnits(119000000)).toBe(1190000)
    expect(toMinorUnits(-0.01)).toBe(-1)
  })

  it("rechaza montos y cantidades no finitas", () => {
    expect(() => toMinorUnits(Number.NaN)).toThrow(TypeError)
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY)).toThrow(TypeError)
    expect(() => multiplyAmount(100, Number.NaN)).toThrow(TypeError)
    expect(() => applyTaxRate(100, -0.1)).toThrow(TypeError)
  })

  it("sigue siendo exacto en el techo de numeric(14,2)", () => {
    const big = 999_999_999_99.99
    expect(Number.isSafeInteger(toMinorUnits(big))).toBe(true)
    expect(addAmounts(big, 0.01)).toBe(100_000_000_000)
  })
})

describe("money — monedas", () => {
  it("no permite mezclar monedas en un total único", () => {
    expect(() =>
      assertSameCurrency([
        { amount: 100, currency: "CLP" },
        { amount: 100, currency: "USD" },
      ]),
    ).toThrow(CurrencyMismatchError)
  })

  it("acepta una lista homogénea y devuelve su moneda", () => {
    expect(assertSameCurrency([{ amount: 1, currency: "CLP" }])).toBe("CLP")
    expect(assertSameCurrency([])).toBeNull()
  })

  it("agrupa por moneda en vez de inventar una suma", () => {
    expect(
      sumByCurrency([
        { amount: 1000, currency: "CLP" },
        { amount: 500, currency: "USD" },
        { amount: 2000, currency: "CLP" },
      ]),
    ).toEqual([
      { currency: "CLP", amount: 3000 },
      { currency: "USD", amount: 500 },
    ])
  })

  it("formatea CLP sin decimales y USD con dos", () => {
    // El separador es un espacio no separable en es-CL; se compara sin él.
    expect(formatMoney(1190000, "CLP").replace(/\s/g, "")).toBe("$1.190.000")
    expect(formatMoney(1190.5, "USD")).toContain("1.190,50")
  })

  it("antepone el signo al símbolo en negativos, como formatCLP", () => {
    // Intl es-CL produce "$-1.190.000"; la convención de la plataforma es "-$".
    expect(formatMoney(-1190000, "CLP").replace(/\s/g, "")).toBe("-$1.190.000")
    expect(formatMoney(-0, "CLP").replace(/\s/g, "")).toBe("$0")
  })
})

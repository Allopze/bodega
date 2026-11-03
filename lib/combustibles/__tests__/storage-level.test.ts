import { describe, expect, it } from "vitest"
import { describeStorageLevel, summarizeStorageLevels } from "../storage-level"

const level = (balanceLiters: number, capacityLiters: number | null) => ({ balanceLiters, capacityLiters })

describe("describeStorageLevel", () => {
  it("un nivel dentro de la capacidad es «ok» y dice qué parte de la capacidad ocupa", () => {
    const described = describeStorageLevel(level(12_400, 20_000))
    expect(described).toMatchObject({ hasCapacity: true, tone: "ok", problem: null, pct: 62 })
    expect(described.valueText).toBe("12.400 L de 20.000 L")
    expect(described.note).toBe("62 % de su capacidad")
  })

  it("justo en la capacidad no es un problema; un litro sobre ella sí", () => {
    expect(describeStorageLevel(level(5_000, 5_000))).toMatchObject({ tone: "ok", problem: null, pct: 100 })
    expect(describeStorageLevel(level(5_001, 5_000))).toMatchObject({ tone: "danger", problem: "over" })
  })

  it("sobre la capacidad es «danger» y dice cuánto se pasa", () => {
    const described = describeStorageLevel(level(7_900, 5_000))
    expect(described).toMatchObject({ hasCapacity: true, tone: "danger", problem: "over" })
    expect(described.valueText).toBe("7.900 L de 5.000 L")
    expect(described.note).toBe("Sobre su capacidad en 2.900 L")
  })

  it("un nivel negativo es «danger» con o sin capacidad: más salidas que entradas registradas", () => {
    const withCapacity = describeStorageLevel(level(-300, 5_000))
    expect(withCapacity).toMatchObject({ tone: "danger", problem: "negative", pct: 0 })
    expect(withCapacity.note).toBe("Nivel negativo: hay más salidas que entradas registradas")
    expect(describeStorageLevel(level(-300, null))).toMatchObject({ hasCapacity: false, tone: "danger", problem: "negative", pct: null })
  })

  it("sin capacidad no inventa una escala: sólo la cifra del nivel", () => {
    const described = describeStorageLevel(level(7_900, null))
    expect(described).toMatchObject({ hasCapacity: false, tone: "neutral", problem: null, pct: null })
    expect(described.valueText).toBe("7.900 L")
    expect(described.note).toBe("Sin capacidad informada")
  })

  it("una capacidad en cero no es una capacidad (el esquema la prohíbe, pero la pantalla no se rompe)", () => {
    expect(describeStorageLevel(level(100, 0))).toMatchObject({ hasCapacity: false, tone: "neutral", pct: null })
  })

  it("un estanque vacío con capacidad es «ok» con 0 %", () => {
    expect(describeStorageLevel(level(0, 20_000))).toMatchObject({ tone: "ok", problem: null, pct: 0 })
  })
})

describe("summarizeStorageLevels", () => {
  it("cuenta los estanques sobre su capacidad", () => {
    expect(summarizeStorageLevels([level(7_900, 5_000), level(1_000, 5_000), level(900, 4_000), level(8_000, 6_000), level(10, 100)]))
      .toBe("2 de 5 estanques están sobre su capacidad.")
    expect(summarizeStorageLevels([level(7_900, 5_000), level(1_000, 5_000)])).toBe("1 de 2 estanques está sobre su capacidad.")
  })

  it("si ninguno se pasa, lo dice", () => {
    expect(summarizeStorageLevels([level(1_000, 5_000), level(2_000, 5_000)])).toBe("Ningún estanque pasa su capacidad.")
    expect(summarizeStorageLevels([level(1_000, 5_000)])).toBe("Ningún estanque pasa su capacidad.")
  })

  it("nombra los niveles negativos aparte", () => {
    expect(summarizeStorageLevels([level(-50, 5_000), level(1_000, 5_000), level(9_000, 5_000)]))
      .toBe("1 de 3 estanques está sobre su capacidad y 1 tiene un nivel negativo.")
    expect(summarizeStorageLevels([level(-50, 5_000), level(-10, null), level(1_000, 5_000)]))
      .toBe("2 de 3 estanques tienen un nivel negativo. 1 no tiene capacidad informada, así que sólo se ve su nivel.")
  })

  it("avisa de los que no tienen capacidad informada sin contarlos como problema", () => {
    expect(summarizeStorageLevels([level(1_000, 5_000), level(2_000, null), level(3_000, null)]))
      .toBe("Ningún estanque pasa su capacidad. 2 no tienen capacidad informada, así que sólo se ve su nivel.")
    expect(summarizeStorageLevels([level(1_000, null)])).toBe("Ningún estanque tiene capacidad informada: sólo se ve su nivel.")
  })

  it("sin estanques no hay frase", () => {
    expect(summarizeStorageLevels([])).toBeNull()
  })
})

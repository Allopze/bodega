import { describe, expect, it } from "vitest"
import { MEASURE_GROUP_THRESHOLD, groupMeasures, normalizeMeasure, similarity } from "./dedup"

describe("normalización de medidas", () => {
  it("pasa a minúsculas, quita tildes, puntuación y palabras vacías", () => {
    expect(normalizeMeasure("Colocar TOPES de descarga, en la pendiente.")).toBe("colocar topes descarga pendiente")
    expect(normalizeMeasure("Instalación de BARANDA ¡urgente!")).toBe("instalacion baranda urgente")
  })

  it("colapsa espacios sobrantes", () => {
    expect(normalizeMeasure("  señalizar   y   delimitar  ")).toBe("senalizar delimitar")
  })

  it("el umbral por defecto es el documentado", () => {
    expect(MEASURE_GROUP_THRESHOLD).toBe(0.6)
  })
})

describe("similitud de Jaccard", () => {
  it("idénticas dan 1 y sin solape dan 0", () => {
    expect(similarity("Colocar topes de descarga", "colocar topes de descarga")).toBe(1)
    expect(similarity("Instalar baranda", "Capacitar en izaje")).toBe(0)
  })

  it("parcial pondera por tokens compartidos", () => {
    expect(similarity("colocar topes descarga", "colocar topes descarga pendiente")).toBeCloseTo(0.75)
  })
})

describe("agrupación de medidas", () => {
  it("agrupa dos descripciones casi iguales", () => {
    const groups = groupMeasures(
      [
        { id: "a", description: "Colocar topes de descarga" },
        { id: "b", description: "colocar topes de descarga en la pendiente" },
      ],
      MEASURE_GROUP_THRESHOLD,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]).toEqual({ key: "a", measures: ["a", "b"] })
  })

  it("no agrupa dos medidas distintas", () => {
    const groups = groupMeasures(
      [
        { id: "a", description: "Instalar baranda" },
        { id: "b", description: "Capacitar en izaje" },
      ],
      MEASURE_GROUP_THRESHOLD,
    )
    expect(groups).toHaveLength(2)
    expect(groups).toEqual([
      { key: "a", measures: ["a"] },
      { key: "b", measures: ["b"] },
    ])
  })

  it("no fusiona transitivamente grupos distintos (cada medida en un solo grupo)", () => {
    const groups = groupMeasures(
      [
        { id: "a", description: "colocar topes descarga" },
        { id: "b", description: "colocar topes descarga pendiente" },
        { id: "c", description: "colocar topes pendiente refuerzo" },
      ],
      MEASURE_GROUP_THRESHOLD,
    )
    expect(groups).toEqual([
      { key: "a", measures: ["a", "b"] },
      { key: "c", measures: ["c"] },
    ])
  })
})

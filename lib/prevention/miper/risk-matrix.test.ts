import { describe, expect, it } from "vitest"
import { classify } from "./methodology"
import {
  buildRiskMatrix, cellName, classificationOfRiskLevel, RISK_MATRIX_CONSEQUENCES, RISK_MATRIX_PROBABILITIES,
  riskMatrixSummary, summarizeResidual,
} from "./risk-matrix"

const at = (probability: number | null, consequence: number | null, times = 1) =>
  Array.from({ length: times }, () => ({ probability, consequence }))

describe("buildRiskMatrix — conteo por probabilidad × consecuencia", () => {
  it("la grilla es de 3 × 3: la probabilidad más alta arriba y la consecuencia creciente hacia la derecha", () => {
    const { cells } = buildRiskMatrix([])
    expect(cells).toHaveLength(9)
    expect([...RISK_MATRIX_PROBABILITIES]).toEqual([4, 2, 1])
    expect([...RISK_MATRIX_CONSEQUENCES]).toEqual([1, 2, 4])
    expect(cells.map((cell) => cellName(cell))).toEqual([
      "P4 × C1", "P4 × C2", "P4 × C4",
      "P2 × C1", "P2 × C2", "P2 × C4",
      "P1 × C1", "P1 × C2", "P1 × C4",
    ])
  })

  it("cada celda lleva la clasificación discreta de la metodología (la misma `classify` que la columna generada)", () => {
    const { cells } = buildRiskMatrix([])
    for (const cell of cells) {
      expect(cell.magnitude).toBe(cell.probability * cell.consequence)
      expect(cell.classification).toBe(classify(cell.probability, cell.consequence))
    }
    // Dos celdas distintas con la misma magnitud comparten banda: P4×C2 y P2×C4 son 8, «Importante».
    const band = (name: string) => cells.find((cell) => cellName(cell) === name)!.classification
    expect(band("P4 × C2")).toBe("important")
    expect(band("P2 × C4")).toBe("important")
    expect(band("P4 × C4")).toBe("intolerable")
    expect(band("P1 × C2")).toBe("tolerable")
  })

  it("cuenta por celda y manda a «sin evaluar» lo que no tiene P o C (o no está en la escala 1-2-4)", () => {
    const matrix = buildRiskMatrix([
      ...at(4, 2, 3), ...at(1, 1, 2), ...at(2, 4),
      ...at(null, 2), ...at(4, null), ...at(null, null), ...at(3, 2),
    ])
    const count = (name: string) => matrix.cells.find((cell) => cellName(cell) === name)!.count
    expect(count("P4 × C2")).toBe(3)
    expect(count("P1 × C1")).toBe(2)
    expect(count("P2 × C4")).toBe(1)
    expect(matrix.cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(6)
    expect(matrix).toMatchObject({ total: 10, evaluated: 6, unevaluated: 4 })
  })

  it("agrega por clasificación y suma los graves (Importantes + Intolerables)", () => {
    const matrix = buildRiskMatrix([...at(4, 2, 3), ...at(2, 4), ...at(4, 4), ...at(1, 1, 2), ...at(2, 2)])
    expect(matrix.byClassification).toEqual({ tolerable: 2, moderate: 1, important: 4, intolerable: 1 })
    expect(matrix.severe).toBe(5)
  })

  it("la celda más cargada gana por conteo; con empate, por magnitud y luego por probabilidad (determinista)", () => {
    expect(cellName(buildRiskMatrix([...at(4, 2, 3), ...at(1, 1, 2)]).busiest!)).toBe("P4 × C2")
    // Empate 2–2 entre P1×C1 (MR 1) y P2×C4 (MR 8): la de mayor magnitud.
    expect(cellName(buildRiskMatrix([...at(1, 1, 2), ...at(2, 4, 2)]).busiest!)).toBe("P2 × C4")
    // Empate 1–1 entre P4×C2 y P2×C4 (ambas MR 8): la de mayor probabilidad.
    expect(cellName(buildRiskMatrix([...at(2, 4), ...at(4, 2)]).busiest!)).toBe("P4 × C2")
  })

  it("sin riesgos evaluados no hay celda más cargada", () => {
    expect(buildRiskMatrix([]).busiest).toBeNull()
    expect(buildRiskMatrix([]).tied).toBe(0)
    expect(buildRiskMatrix(at(null, null, 3))).toMatchObject({ busiest: null, evaluated: 0, unevaluated: 3, severe: 0 })
  })
})

describe("riskMatrixSummary — la frase que responde dónde se concentra el riesgo", () => {
  it("cuenta los graves sobre los evaluados y nombra la celda más cargada con sus niveles", () => {
    const text = riskMatrixSummary(buildRiskMatrix([...at(4, 2, 3), ...at(2, 4), ...at(1, 1, 2)]))
    expect(text).toBe("4 de 6 riesgos evaluados son Importantes o Intolerables; la celda más cargada es probabilidad Alta × consecuencia Media (P4 × C2), con 3 riesgos.")
  })

  it("con un solo grave, el verbo va en singular", () => {
    const text = riskMatrixSummary(buildRiskMatrix([...at(4, 2), ...at(1, 1, 3)]))
    expect(text).toBe("1 de 4 riesgos evaluados es Importante o Intolerable; la celda más cargada es probabilidad Baja × consecuencia Baja (P1 × C1), con 3 riesgos.")
  })

  it("sin graves lo dice, en vez de «0 de N»", () => {
    const text = riskMatrixSummary(buildRiskMatrix([...at(1, 1, 2), ...at(2, 1)]))
    expect(text).toBe("Ningún riesgo evaluado es Importante ni Intolerable; la celda más cargada es probabilidad Baja × consecuencia Baja (P1 × C1), con 2 riesgos.")
  })

  it("con un empate en lo más alto no finge que una celda concentra: dice cuántas empatan y nombra la más grave", () => {
    const matrix = buildRiskMatrix([...at(4, 4), ...at(2, 4), ...at(1, 2)])
    expect(matrix.tied).toBe(3)
    expect(riskMatrixSummary(matrix)).toBe("2 de 3 riesgos evaluados son Importantes o Intolerables; 3 celdas empatan con 1 riesgo cada una y la más grave es probabilidad Alta × consecuencia Alta (P4 × C4).")
    const pair = buildRiskMatrix([...at(1, 1, 2), ...at(2, 4, 2), ...at(4, 2)])
    expect(riskMatrixSummary(pair)).toBe("3 de 5 riesgos evaluados son Importantes o Intolerables; 2 celdas empatan con 2 riesgos cada una y la más grave es probabilidad Media × consecuencia Alta (P2 × C4).")
  })

  it("con un único riesgo evaluado, no hay «celda más cargada»", () => {
    expect(riskMatrixSummary(buildRiskMatrix(at(4, 4)))).toBe("El único riesgo evaluado está en probabilidad Alta × consecuencia Alta (P4 × C4) y es Intolerable.")
    expect(riskMatrixSummary(buildRiskMatrix(at(1, 2)))).toBe("El único riesgo evaluado está en probabilidad Baja × consecuencia Media (P1 × C2) y es Tolerable.")
  })
})

describe("residual — el nivel de 4 escalones se lee en el vocabulario de la clasificación", () => {
  it("cada nivel corresponde a su banda (el inverso de `criticalityOf`)", () => {
    expect(classificationOfRiskLevel("low")).toBe("tolerable")
    expect(classificationOfRiskLevel("medium")).toBe("moderate")
    expect(classificationOfRiskLevel("high")).toBe("important")
    expect(classificationOfRiskLevel("critical")).toBe("intolerable")
  })

  it("cuenta sólo las filas de esta MIPER y sólo los niveles que se entienden", () => {
    const result = summarizeResidual(["a", "b", "c", "d"], { a: "high", b: "low", c: "no-es-un-nivel", z: "critical" })
    expect(result).toEqual({ total: 4, recorded: 2, counts: { tolerable: 1, moderate: 0, important: 1, intolerable: 0 } })
  })

  it("acepta los sinónimos que normaliza `normalizeRiskLevel` (el Excel histórico)", () => {
    expect(summarizeResidual(["a"], { a: "Alto" }).counts.important).toBe(1)
  })

  it("sin ningún nivel registrado (producción hoy), `recorded` es 0", () => {
    expect(summarizeResidual(["a", "b"], {})).toEqual({ total: 2, recorded: 0, counts: { tolerable: 0, moderate: 0, important: 0, intolerable: 0 } })
  })
})

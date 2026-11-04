import { describe, expect, it } from "vitest"
import { classify } from "./methodology"
import {
  buildRiskMatrix, cellName, cellParam, classificationOfRiskLevel, parseCellParam, RISK_MATRIX_CONSEQUENCES, RISK_MATRIX_PROBABILITIES,
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

describe("peligros más frecuentes de cada celda (P-3)", () => {
  const haz = (probability: number | null, consequence: number | null, hazard: string | null, times = 1) =>
    Array.from({ length: times }, () => ({ probability, consequence, hazard }))
  const cell = (matrix: ReturnType<typeof buildRiskMatrix>, name: string) => matrix.cells.find((candidate) => cellName(candidate) === name)!

  it("lista los 3 peligros más repetidos de la celda, el más frecuente primero, con su cuenta", () => {
    const matrix = buildRiskMatrix([
      ...haz(4, 2, "Caída de objetos", 3), ...haz(4, 2, "Ruido", 2), ...haz(4, 2, "Atrapamiento", 4), ...haz(4, 2, "Polvo", 1),
    ])
    expect(cell(matrix, "P4 × C2").topHazards).toEqual([
      { label: "Atrapamiento", count: 4 }, { label: "Caída de objetos", count: 3 }, { label: "Ruido", count: 2 },
    ])
    // Un peligro más que no cabe: se dice cuántos quedaron fuera, no se calla.
    expect(cell(matrix, "P4 × C2").moreHazards).toBe(1)
  })

  it("cuenta como un solo peligro lo que sólo difiere en tildes, mayúsculas o espacios, y rotula con la escritura más repetida", () => {
    const matrix = buildRiskMatrix([
      ...haz(2, 2, "Caida de objetos"), ...haz(2, 2, "Caída  de objetos", 2), ...haz(2, 2, "  caída de OBJETOS "),
    ])
    expect(cell(matrix, "P2 × C2").topHazards).toEqual([{ label: "Caída de objetos", count: 4 }])
    expect(cell(matrix, "P2 × C2").moreHazards).toBe(0)
  })

  it("con empate de cuentas ordena por nombre (determinista, sin depender del orden de las filas)", () => {
    const a = buildRiskMatrix([...haz(1, 1, "Zanja"), ...haz(1, 1, "Ácido"), ...haz(1, 1, "Bodega")])
    const b = buildRiskMatrix([...haz(1, 1, "Bodega"), ...haz(1, 1, "Zanja"), ...haz(1, 1, "Ácido")])
    expect(cell(a, "P1 × C1").topHazards.map((hazard) => hazard.label)).toEqual(["Ácido", "Bodega", "Zanja"])
    expect(cell(b, "P1 × C1").topHazards).toEqual(cell(a, "P1 × C1").topHazards)
  })

  it("cada celda cuenta sólo lo suyo; una celda vacía o sin peligro escrito no tiene lista", () => {
    const matrix = buildRiskMatrix([...haz(4, 4, "Incendio"), ...haz(1, 1, null), ...haz(1, 1, "   "), ...haz(null, 2, "Sin evaluar")])
    expect(cell(matrix, "P4 × C4").topHazards).toEqual([{ label: "Incendio", count: 1 }])
    expect(cell(matrix, "P1 × C1")).toMatchObject({ count: 2, topHazards: [], moreHazards: 0 })
    expect(cell(matrix, "P2 × C2")).toMatchObject({ count: 0, topHazards: [] })
    // El peligro de un riesgo sin P o C no aparece en ninguna celda: no entra en la grilla.
    expect(matrix.cells.flatMap((candidate) => candidate.topHazards.map((hazard) => hazard.label))).not.toContain("Sin evaluar")
  })

  it("un peligro que falta en el dato (filas sin la columna) no rompe el conteo", () => {
    const matrix = buildRiskMatrix(at(4, 2, 2))
    expect(cell(matrix, "P4 × C2")).toMatchObject({ count: 2, topHazards: [], moreHazards: 0 })
  })
})

describe("?celda= — la celda exacta en la URL", () => {
  it("ida y vuelta para las nueve celdas de la grilla", () => {
    for (const probability of RISK_MATRIX_PROBABILITIES) {
      for (const consequence of RISK_MATRIX_CONSEQUENCES) {
        expect(parseCellParam(cellParam({ probability, consequence }))).toEqual({ probability, consequence })
      }
    }
    expect(cellParam({ probability: 4, consequence: 2 })).toBe("P4xC2")
  })

  it("lo que no es una celda de la escala 1-2-4 no filtra: ni valores fuera de escala ni basura", () => {
    for (const value of [null, undefined, "", "P3xC2", "P4xC3", "P0xC1", "4x2", "P4C2", "P4xC2x", "P4xC", "important"]) {
      expect(parseCellParam(value)).toBeNull()
    }
    expect(parseCellParam(" p2xc4 ")).toEqual({ probability: 2, consequence: 4 })
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

import { describe, expect, it } from "vitest"
import { riskFactorKey, suggestedFactorMapping, suggestRiskFactor, unknownFactorsOf, waitsForFactor } from "./factor-suggestion"

/** El catálogo de la plataforma (`prevention_risk_factors`), con ids de prueba. */
const CATALOG = ["Locativo", "Mecánico", "Físico", "Químico", "Biológico", "Eléctrico", "Ergonómico", "Psicosocial", "Factor humano", "Ambiente de trabajo", "Tránsito"]
  .map((name, index) => ({ id: `f${index + 1}`, name }))
const nameOf = (id: string | null) => CATALOG.find((factor) => factor.id === id)?.name ?? null
const suggest = (name: string) => nameOf(suggestRiskFactor(name, CATALOG))

describe("suggestRiskFactor: los FACTORES DE RIESGO de los RE-04 reales que el catálogo no reconoce", () => {
  it("una errata de una o dos letras sugiere el factor", () => {
    expect(suggest("MCANICO")).toBe("Mecánico")
    expect(suggest("PSISCOSOCIAL")).toBe("Psicosocial")
  })
  it("un compuesto sugiere su primera parte que calce; un nombre que empieza con un factor, ese factor", () => {
    expect(suggest("MECÁNICO / ELÉCTRICO")).toBe("Mecánico")
    expect(suggest("MECÁNICO / TRÁNSITO")).toBe("Mecánico")
    expect(suggest("SUSTANCIAS / BIOLÓGICO")).toBe("Biológico")
    expect(suggest("ERGONÓMICO FUNCIONAL")).toBe("Ergonómico")
  })
  it("sin un parecido claro no sugiere nada: una tarea escrita en la columna del factor la decide una persona", () => {
    expect(suggest("Traslado de contenedor")).toBeNull()
    expect(suggest("Firma Report")).toBeNull()
    expect(suggest("SOCIAL")).toBeNull()
    expect(suggest("AMBIENTAL")).toBeNull()
    // Con menos de cinco letras, dos cambios ya son otra palabra.
    expect(suggest("FISI")).toBeNull()
  })
  it("la clave ignora mayúsculas, tildes y espacios sobrantes, como la carga", () => {
    expect(riskFactorKey("  MECÁNICO   ")).toBe("mecanico")
    expect(riskFactorKey("   ")).toBeNull()
    expect(riskFactorKey(null)).toBeNull()
  })
})

describe("factores de la vista previa: los comparten el diálogo y scripts/importar-miper-re04.ts", () => {
  const issue = (excel: string) => [{ code: "unknown_factor", excel }]
  const ROWS = [
    { status: "needs_review", riskFactorName: "MCANICO", issues: issue("MCANICO") },
    { status: "needs_review", riskFactorName: "mcanico ", issues: issue("mcanico ") },
    { status: "needs_review", riskFactorName: "SOCIAL", issues: issue("SOCIAL") },
    { status: "ready", riskFactorName: "Físico", issues: [] },
  ]

  it("cada factor desconocido aparece una vez, con cuántas filas lo usan", () => {
    expect(unknownFactorsOf(ROWS)).toEqual([{ key: "mcanico", name: "MCANICO", rows: 2 }, { key: "social", name: "SOCIAL", rows: 1 }])
  })

  it("la asignación sugerida sólo trae lo parecido; la fila espera mientras su factor no esté asignado", () => {
    const mapping = suggestedFactorMapping(ROWS, CATALOG)
    expect(Object.fromEntries(Object.entries(mapping).map(([key, id]) => [key, nameOf(id)]))).toEqual({ mcanico: "Mecánico" })
    expect(ROWS.map((row) => waitsForFactor(row, mapping))).toEqual([false, false, true, false])
  })
})

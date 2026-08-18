import { describe, expect, it } from "vitest"
import { calculateInstanceCompliance } from "@/lib/services/pdtp/execution-checklists"
import type { ChecklistDefinition } from "@/lib/sst/types"

/**
 * El porcentaje de cumplimiento del checklist es una cifra normativa: alimenta
 * `porcentajeCumplimiento`, de ahí el cumplimiento integral del programa
 * (0,5·ejecución + 0,3·verificación + 0,2·cierre) y los tableros.
 *
 * Antes de esta suite su única aserción era la degenerada (checklist vacío →
 * null), así que cambiar `PARTIAL_STATUS_WEIGHT`, mover `na` al denominador o
 * renombrar un sinónimo de "cumple" pasaba en verde. El comentario del propio
 * servicio dice que el bug de contar los `na` YA ocurrió una vez.
 */
function definitionWith(itemIds: string[]): ChecklistDefinition {
  return {
    code: "TEST", version: "01", revisionDate: "2026-01-01", title: "Test",
    tipo: "nuevo", legalFramework: [], applicableTo: "",
    sections: [{
      id: "s1",
      title: "Sección",
      items: itemIds.map((id) => ({ id, label: id, kind: "bueno_regular_malo_na_nt_obs" as const })),
    }],
    closingAct: { title: "", resultOptions: [], signatureRoles: [] },
  } as unknown as ChecklistDefinition
}

const responses = (pairs: Array<[string, string]>) =>
  pairs.map(([itemId, estado]) => ({ seccionId: "s1", itemId, estado }))

describe("calculateInstanceCompliance — escala B/R/M", () => {
  it("regular vale medio punto: cumple + regular + no_cumple = 50%", () => {
    const definition = definitionWith(["a", "b", "c"])
    const result = calculateInstanceCompliance(definition, responses([
      ["a", "cumple"], ["b", "regular"], ["c", "no_cumple"],
    ]))
    // (1 + 0,5 + 0) / 3
    expect(result).toBe(50)
  })

  it("excluye 'na' y 'no_tiene' del DENOMINADOR, no los cuenta como incumplidos", () => {
    const definition = definitionWith(["a", "b", "c"])
    const result = calculateInstanceCompliance(definition, responses([
      ["a", "cumple"], ["b", "na"], ["c", "no_tiene"],
    ]))
    expect(result).toBe(100)
  })

  it("devuelve null cuando todo lo respondido está excluido (no 0%)", () => {
    const definition = definitionWith(["a", "b"])
    const result = calculateInstanceCompliance(definition, responses([
      ["a", "na"], ["b", "no_tiene"],
    ]))
    expect(result).toBeNull()
  })

  it("los cuatro sinónimos de conformidad puntúan igual que 'cumple'", () => {
    for (const estado of ["cumple", "entregado", "apto", "si"]) {
      const definition = definitionWith(["a"])
      expect(calculateInstanceCompliance(definition, responses([["a", estado]]))).toBe(100)
    }
  })

  it("un ítem sin responder no entra al denominador", () => {
    const definition = definitionWith(["a", "b"])
    const result = calculateInstanceCompliance(definition, responses([["a", "cumple"]]))
    expect(result).toBe(100)
  })

  it("redondea a dos decimales: 1 de 3 conformes = 33.33%", () => {
    const definition = definitionWith(["a", "b", "c"])
    const result = calculateInstanceCompliance(definition, responses([
      ["a", "cumple"], ["b", "no_cumple"], ["c", "no_cumple"],
    ]))
    expect(result).toBe(33.33)
  })
})

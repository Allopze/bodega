/**
 * La verificación de condiciones ambientales básicas (DS 594, PDTP n=10) es
 * una definición de datos: lo que puede romperse es la coherencia entre sus
 * ítems y las puertas del motor, no una rama de código. Estas pruebas fijan
 * eso, sin base de datos — mismo molde que reporte-equipos-definition.test.ts.
 */
import { describe, expect, it } from "vitest"
import { INSPECCION_CONDICIONES_AMBIENTALES } from "@/lib/sst/definitions/inspeccion-condiciones-ambientales"
import { CHECKLIST_DEFINITIONS } from "@/lib/sst/definitions"
import {
  assessRunCompletion,
  deriveFindings,
  summarizeCompliance,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"
import type { ChecklistDefinition } from "@/lib/sst/types"

function itemsOf(definition: ChecklistDefinition): InspectionItemSpec[] {
  return definition.sections.flatMap((section) =>
    section.items.map((item) => ({
      sectionId: section.id,
      itemId: item.id,
      label: item.label,
      required: item.required ?? false,
      countsForCompliance: section.countsForCompliance ?? true,
      danoPotencial: item.danoPotencial ?? null,
      kind: item.kind,
      options: item.options,
      placeholder: item.placeholder,
    })),
  )
}

const items = itemsOf(INSPECCION_CONDICIONES_AMBIENTALES)
const scorable = items.filter((item) => item.countsForCompliance)

describe("Verificación de Condiciones Ambientales Básicas (DS 594)", () => {
  it("está registrada en el catálogo importable", () => {
    expect(CHECKLIST_DEFINITIONS["inspeccion_condiciones_ambientales"]).toBe(INSPECCION_CONDICIONES_AMBIENTALES)
  })

  it("declara sólo la Ley 21.512 (ex DS 594), no PREXOR ni frío/calor", () => {
    // Ruido y temperatura extrema ya tienen su propio protocolo de higiene
    // (N°45-49); listarlos acá mediría dos veces el mismo hecho.
    expect(INSPECCION_CONDICIONES_AMBIENTALES.legalFramework).toEqual(["Ley 21.512 (ex DS 594)"])
  })

  it("tiene doce ítems puntuables, todos con N/A disponible", () => {
    expect(scorable).toHaveLength(12)
    expect(scorable.every((item) => item.kind === "cumple_parcial_nocumple_na_obs")).toBe(true)
  })

  it("deja la observación libre fuera del porcentaje de cumplimiento", () => {
    const libre = items.find((item) => item.itemId === "observacion_libre")!
    expect(libre.countsForCompliance).toBe(false)
    expect(libre.kind).toBe("text")
  })

  it("bloquea completar sin responder nada y deja pasar una faena conforme", () => {
    expect(assessRunCompletion(items, []).allowed).toBe(false)
    const answers = scorable.map((item) => ({ sectionId: item.sectionId, itemId: item.itemId, result: "conforming" as const, comment: null }))
    expect(assessRunCompletion(items, answers)).toMatchObject({ allowed: true, blockers: [] })
    expect(summarizeCompliance(items, answers).compliancePercent).toBe(100)
  })

  it("un N/A no cuenta en contra: una faena sin duchas igual llega a 100%", () => {
    const answers = scorable.map((item) => item.itemId === "duchas_agua_caliente"
      ? { sectionId: item.sectionId, itemId: item.itemId, result: "not_applicable" as const, comment: "La faena no genera suciedad ni exposición que exija duchas." }
      : { sectionId: item.sectionId, itemId: item.itemId, result: "conforming" as const, comment: null })
    expect(summarizeCompliance(items, answers).compliancePercent).toBe(100)
  })

  it("levanta hallazgo cuando el agua potable no cumple", () => {
    const item = items.find((entry) => entry.itemId === "agua_potable")!
    const [finding] = deriveFindings(items, [{ sectionId: item.sectionId, itemId: item.itemId, result: "non_conforming", comment: "Estanque sin mantención hace 6 meses." }])
    expect(finding).toBeDefined()
    expect(finding?.criticality).toBeDefined()
  })

  it("declara la firma del prevencionista, sin acompañante fijo", () => {
    expect(INSPECCION_CONDICIONES_AMBIENTALES.closingAct!.signatureRoles).toEqual(["prevencionista"])
  })
})

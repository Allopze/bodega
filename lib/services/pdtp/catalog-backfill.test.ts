import { describe, expect, it } from "vitest"
import { planAnnualCatalogMappings } from "./catalog-backfill"

const manifest = [
  { id: "catalog-1", legacyNumber: 1, description: "Actividad uno", executionGuidance: "Guía uno" },
  { id: "catalog-2", legacyNumber: 2, description: "Actividad dos", executionGuidance: "Guía dos" },
]

describe("preflight del backfill de actividades de catálogo", () => {
  it("mapea sólo coincidencias literales y preserva la identidad entre programas", () => {
    expect(planAnnualCatalogMappings({ manifest, annualActivities: [
      { id: "annual-2026", programId: "p-2026", n: 1, activity: "Actividad uno", program: "Guía uno", catalogActivityId: null },
      { id: "annual-2027", programId: "p-2027", n: 1, activity: "Actividad uno", program: "Guía uno", catalogActivityId: null },
    ] })).toEqual({
      mappings: [
        { annualActivityId: "annual-2026", programId: "p-2026", n: 1, catalogActivityId: "catalog-1" },
        { annualActivityId: "annual-2027", programId: "p-2027", n: 1, catalogActivityId: "catalog-1" },
      ],
      issues: [],
    })
  })

  it("bloquea texto desconocido y duplicados de identidad dentro del programa", () => {
    const result = planAnnualCatalogMappings({ manifest, annualActivities: [
      { id: "unknown", programId: "p-2026", n: 1, activity: "Texto alterado", program: "Guía uno", catalogActivityId: null },
      { id: "duplicate-a", programId: "p-2027", n: 2, activity: "Actividad dos", program: "Guía dos", catalogActivityId: null },
      { id: "duplicate-b", programId: "p-2027", n: 2, activity: "Actividad dos", program: "Guía dos", catalogActivityId: null },
    ] })

    expect(result.issues).toEqual([
      expect.stringMatching(/unknown.*sin coincidencia/i),
      expect.stringMatching(/p-2027.*duplicada/i),
    ])
  })
})

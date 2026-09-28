import { describe, expect, it } from "vitest"
import { INSPECCION_EPP } from "@/lib/sst/definitions/inspeccion-epp"
import { EPP_USE_SECTION_ID } from "@/lib/sst/definitions/inspeccion-epp-sections"
import {
  eppInspectionItemKind,
  eppRowId,
  resolveEppInspectionDefinition,
  type WorksiteEppRow,
} from "./epp-inspection-rows"

const ROWS: WorksiteEppRow[] = [
  { key: "fam:fam-casco-1", label: "Casco Activex", eppTypeCode: "cabeza" },
  { key: "prd:prd-guante-9", label: "Guante nitrilo", eppTypeCode: null },
]

function matrixItems(definition: typeof INSPECCION_EPP) {
  return definition.sections.find((section) => section.id === EPP_USE_SECTION_ID)!.items
}

describe("resolveEppInspectionDefinition", () => {
  it("lista los EPP de la bodega de la faena, con Uso y Estado por separado", () => {
    const resolved = resolveEppInspectionDefinition(INSPECCION_EPP, {
      rows: ROWS, answered: new Map(), runStatus: "planned",
    })
    const items = matrixItems(resolved)
    expect(items.map((item) => item.id)).toEqual([
      `${eppRowId("fam:fam-casco-1")}_uso`, `${eppRowId("fam:fam-casco-1")}_estado`,
      `${eppRowId("prd:prd-guante-9")}_uso`, `${eppRowId("prd:prd-guante-9")}_estado`,
    ])
    expect(items[0]).toMatchObject({ label: "Casco Activex: usa", kind: "si_no_na_obs", danoPotencial: "fatal" })
    expect(items[3]).toMatchObject({ label: "Guante nitrilo: estado", kind: "bueno_regular_malo_obs", danoPotencial: "grave" })
    // La lista fija ya no aparece cuando la faena tiene historial.
    expect(items.some((item) => item.id === "zapatos_seguridad_uso")).toBe(false)
  })

  it("no toca las demás secciones", () => {
    const resolved = resolveEppInspectionDefinition(INSPECCION_EPP, {
      rows: ROWS, answered: new Map(), runStatus: "planned",
    })
    expect(resolved.sections.find((section) => section.id === "observaciones_epp"))
      .toEqual(INSPECCION_EPP.sections.find((section) => section.id === "observaciones_epp"))
  })

  it("sin historial en la bodega conserva la lista fija completa", () => {
    const resolved = resolveEppInspectionDefinition(INSPECCION_EPP, {
      rows: [], answered: new Map([["zapatos_seguridad_uso", "Zapatos de seguridad: usa"]]), runStatus: "in_progress",
    })
    expect(matrixItems(resolved)).toEqual(matrixItems(INSPECCION_EPP))
  })

  it("una fila fija ya respondida sigue presente junto a las de la bodega", () => {
    const resolved = resolveEppInspectionDefinition(INSPECCION_EPP, {
      rows: ROWS, answered: new Map([["zapatos_seguridad_uso", "Zapatos de seguridad: usa"]]), runStatus: "in_progress",
    })
    const ids = matrixItems(resolved).map((item) => item.id)
    expect(ids).toContain("zapatos_seguridad_uso")
    expect(ids).not.toContain("zapatos_seguridad_estado")
    expect(ids).toContain(`${eppRowId("fam:fam-casco-1")}_uso`)
  })

  it("una fila respondida cuyo EPP ya no figura se reconstruye desde la respuesta", () => {
    const gone = `${eppRowId("fam:fam-retirada")}_estado`
    const resolved = resolveEppInspectionDefinition(INSPECCION_EPP, {
      rows: ROWS, answered: new Map([[gone, "Antiparra vieja: estado"]]), runStatus: "in_progress",
    })
    const item = matrixItems(resolved).find((candidate) => candidate.id === gone)
    expect(item).toMatchObject({ label: "Antiparra vieja: estado", kind: "bueno_regular_malo_obs" })
  })

  it("un run ejecutado no gana filas que llegaron después a la bodega", () => {
    const answeredId = `${eppRowId("fam:fam-casco-1")}_uso`
    const resolved = resolveEppInspectionDefinition(INSPECCION_EPP, {
      rows: ROWS, answered: new Map([[answeredId, "Casco Activex: usa"]]), runStatus: "completed",
    })
    expect(matrixItems(resolved).map((item) => item.id)).toEqual([answeredId])
  })

  it("deja intacta cualquier otra plantilla", () => {
    const other = { ...INSPECCION_EPP, sections: INSPECCION_EPP.sections.filter((section) => section.id !== EPP_USE_SECTION_ID) }
    expect(resolveEppInspectionDefinition(other, { rows: ROWS, answered: new Map(), runStatus: "planned" })).toBe(other)
  })
})

describe("eppInspectionItemKind", () => {
  it("deduce la escala de una fila armada desde la bodega", () => {
    expect(eppInspectionItemKind(EPP_USE_SECTION_ID, "epp_fam_x_uso")).toBe("si_no_na_obs")
    expect(eppInspectionItemKind(EPP_USE_SECTION_ID, "epp_fam_x_estado")).toBe("bueno_regular_malo_obs")
    expect(eppInspectionItemKind("otra", "epp_fam_x_uso")).toBeUndefined()
    expect(eppInspectionItemKind(EPP_USE_SECTION_ID, "zapatos_seguridad_uso")).toBeUndefined()
  })
})

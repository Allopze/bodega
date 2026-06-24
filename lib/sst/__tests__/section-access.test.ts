import { describe, it, expect } from "vitest"
import { getSectionAccess, writableSectionIds } from "@/lib/sst/checklist"
import { TRABAJADOR_NUEVO } from "@/lib/sst/definitions"

const PUNTO_3 = "acompanamiento_terreno"
const OTRAS_SECCIONES = TRABAJADOR_NUEVO.sections
  .map((s) => s.id)
  .filter((id) => id !== PUNTO_3)

describe("getSectionAccess (Punto 3 gating)", () => {
  it("conductor_lider: solo ve/edita el Punto 3", () => {
    const access = getSectionAccess(
      TRABAJADOR_NUEVO,
      ["sst:evaluate_acompanamiento"],
      { canCreate: false, canViewFull: false },
    )
    expect(access[PUNTO_3]).toEqual({ canView: true, canEdit: true })
    for (const id of OTRAS_SECCIONES) {
      expect(access[id]).toEqual({ canView: false, canEdit: false })
    }
  })

  it("prevencionista: ve/edita todo MENOS el Punto 3", () => {
    const access = getSectionAccess(
      TRABAJADOR_NUEVO,
      ["sst:view", "sst:create"],
      { canCreate: true, canViewFull: true },
    )
    expect(access[PUNTO_3]).toEqual({ canView: false, canEdit: false })
    for (const id of OTRAS_SECCIONES) {
      expect(access[id]).toEqual({ canView: true, canEdit: true })
    }
  })

  it("administrador: ve/edita todo, incluido el Punto 3", () => {
    const access = getSectionAccess(
      TRABAJADOR_NUEVO,
      ["sst:view", "sst:create", "sst:evaluate_acompanamiento"],
      { canCreate: true, canViewFull: true },
    )
    for (const id of [PUNTO_3, ...OTRAS_SECCIONES]) {
      expect(access[id]).toEqual({ canView: true, canEdit: true })
    }
  })
})

describe("writableSectionIds (refuerzo server-side)", () => {
  it("conductor_lider solo puede escribir el Punto 3", () => {
    const writable = writableSectionIds(
      TRABAJADOR_NUEVO,
      ["sst:evaluate_acompanamiento"],
      false,
    )
    expect([...writable]).toEqual([PUNTO_3])
  })
})

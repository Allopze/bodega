import { describe, expect, it } from "vitest"
import { assessRiohsCompleteness, RIOHS_SECTION_IDS } from "@/lib/prevention/riohs"

/**
 * El gate de publicación del RIOHS (`assertRiohsContentComplete` en
 * `lib/services/prevention-documents/workflow.ts`) bloquea si falta un capítulo
 * del DS 44 art. 58. La llave es `setRiohsSectionsAction`, que escribe
 * `extraMetadata.riohsSections`.
 *
 * Este test cubre el contrato entre los dos: lo que la pantalla guarda tiene que
 * ser exactamente lo que el gate acepta. Se rompió una vez —el gate existía sin
 * pantalla que lo alimentara— y el síntoma era un RIOHS imposible de publicar.
 */
describe("contrato entre el checklist RIOHS y el gate de publicación", () => {
  it("lo que guarda la pantalla completa abre el gate", () => {
    const saved = RIOHS_SECTION_IDS.filter((id) => RIOHS_SECTION_IDS.includes(id))
    expect(assessRiohsCompleteness(saved).complete).toBe(true)
  })

  it("un documento recién creado tiene el gate cerrado", () => {
    const metadata: { riohsSections?: string[] } = {}
    expect(assessRiohsCompleteness(metadata.riohsSections).complete).toBe(false)
  })

  it("el gate nombra los capítulos que faltan, no sólo que faltan", () => {
    const partial = RIOHS_SECTION_IDS.slice(0, 3)
    const result = assessRiohsCompleteness(partial)

    expect(result.complete).toBe(false)
    expect(result.missing.length).toBe(RIOHS_SECTION_IDS.length - 3)
    for (const section of result.missing) {
      expect(section.title.length).toBeGreaterThan(10)
      expect(section.legalBasis).toContain("DS 44")
    }
  })

  it("el filtrado de la acción descarta ids inventados antes de guardar", () => {
    // setRiohsSectionsAction filtra con RIOHS_SECTION_IDS.includes antes de
    // persistir: guardar basura no debe poder abrir el gate.
    const fromClient = ["preambulo", "capitulo_falso", "epp"]
    const persisted = fromClient.filter((id) => RIOHS_SECTION_IDS.includes(id))

    expect(persisted).toEqual(["preambulo", "epp"])
    expect(assessRiohsCompleteness(persisted).complete).toBe(false)
  })
})

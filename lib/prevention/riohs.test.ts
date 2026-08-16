import { describe, expect, it } from "vitest"
import { assessRiohsCompleteness, RIOHS_SECTION_IDS, RIOHS_SECTIONS } from "./riohs"

describe("assessRiohsCompleteness — contenido mínimo del DS 44 art. 58", () => {
  it("un reglamento sin capítulos declarados no cumple nada", () => {
    const result = assessRiohsCompleteness([])

    expect(result.complete).toBe(false)
    expect(result.percent).toBe(0)
    expect(result.missing).toHaveLength(RIOHS_SECTIONS.filter((s) => s.mandatory).length)
  })

  it("cumple sólo con todos los capítulos obligatorios", () => {
    const result = assessRiohsCompleteness(RIOHS_SECTION_IDS)

    expect(result.complete).toBe(true)
    expect(result.percent).toBe(100)
    expect(result.missing).toEqual([])
  })

  it("nombra exactamente lo que falta, con su base legal", () => {
    const result = assessRiohsCompleteness(RIOHS_SECTION_IDS.filter((id) => id !== "sanciones"))

    expect(result.complete).toBe(false)
    expect(result.missing.map((section) => section.id)).toEqual(["sanciones"])
    expect(result.missing[0]?.legalBasis).toContain("art. 61")
  })

  it("ignora ids desconocidos en vez de inflar el porcentaje", () => {
    const result = assessRiohsCompleteness([...RIOHS_SECTION_IDS, "capitulo_inventado", "otro"])

    expect(result.checked).toEqual(RIOHS_SECTION_IDS)
    expect(result.percent).toBe(100)
  })

  it("tolera null y undefined", () => {
    expect(assessRiohsCompleteness(null).complete).toBe(false)
    expect(assessRiohsCompleteness(undefined).percent).toBe(0)
  })
})

describe("catálogo RIOHS", () => {
  it("no tiene ids repetidos", () => {
    expect(new Set(RIOHS_SECTION_IDS).size).toBe(RIOHS_SECTION_IDS.length)
  })

  it("cubre los tres artículos que fijan el contenido", () => {
    const bases = RIOHS_SECTIONS.map((section) => section.legalBasis).join(" ")
    expect(bases).toContain("art. 58")
    expect(bases).toContain("art. 59")
    expect(bases).toContain("art. 60")
    expect(bases).toContain("art. 61")
  })
})

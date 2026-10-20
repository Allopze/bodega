import { describe, expect, it } from "vitest"
import type { PdtpActivityIdentity, PdtpActivityIdentityMap } from "@/lib/services/prevention-inspections/pdtp-identity"
import { buildTemplatePdtpAccreditation } from "./pdtp-accreditation"

function identityMap(entries: PdtpActivityIdentity[]): PdtpActivityIdentityMap {
  const byNumber = new Map<number, PdtpActivityIdentity>()
  const byCatalogId = new Map<string, PdtpActivityIdentity>()
  for (const entry of entries) {
    byNumber.set(entry.n, entry)
    byCatalogId.set(entry.catalogActivityId, entry)
  }
  return { byNumber, byCatalogId }
}

const identity = (n: number, name: string, over: Partial<PdtpActivityIdentity> = {}): PdtpActivityIdentity => ({
  n, catalogActivityId: `cat-${n}`, name, year: 2026, catalogStatus: "active", ...over,
})

const base = {
  nameByNumber: new Map<number, string>(),
  catalogTitleById: new Map<string, string>(),
}

describe("lo que una plantilla acredita: una sola lectura para la tabla y el diálogo", () => {
  it("los vínculos del catálogo ganan sobre los números, con la etiqueta «N° 29 — nombre»", () => {
    const result = buildTemplatePdtpAccreditation({
      ...base,
      numbers: { execute: [29], review: null },
      bindingIds: { execute: ["cat-29"], review: [] },
      identities: identityMap([identity(29, "Inspección de contenedores")]),
    })
    expect(result.pdtpAccreditation).toEqual({
      source: "catalog",
      executeSource: "catalog",
      reviewSource: "none",
      execute: ["N° 29 — Inspección de contenedores"],
      review: [],
    })
    expect(result.pdtpPreloadExecuteIds).toEqual(["cat-29"])
    expect(result.pdtpUnmappedNumbers).toEqual({ execute: [], review: [] })
  })

  it("un vínculo sin actividad en el programa vigente se muestra con el título del catálogo", () => {
    const result = buildTemplatePdtpAccreditation({
      ...base,
      numbers: { execute: null, review: null },
      bindingIds: { execute: ["cat-x"], review: [] },
      identities: identityMap([]),
      catalogTitleById: new Map([["cat-x", "Orden y aseo de la faena"]]),
    })
    expect(result.pdtpAccreditation.execute).toEqual(["Orden y aseo de la faena"])
    expect(result.pdtpPreloadExecuteIds).toEqual(["cat-x"])
  })

  it("acredita por número cuando no hay vínculo: etiqueta con nombre y diálogo precargado con la actividad equivalente", () => {
    const result = buildTemplatePdtpAccreditation({
      ...base,
      numbers: { execute: [29], review: [26] },
      bindingIds: { execute: [], review: [] },
      identities: identityMap([identity(29, "Inspección de contenedores"), identity(26, "Revisión de contenedores")]),
    })
    expect(result.pdtpAccreditation.source).toBe("numbers")
    expect(result.pdtpAccreditation.execute).toEqual(["N° 29 — Inspección de contenedores"])
    expect(result.pdtpAccreditation.review).toEqual(["N° 26 — Revisión de contenedores"])
    expect(result.pdtpPreloadExecuteIds).toEqual(["cat-29"])
    expect(result.pdtpPreloadReviewIds).toEqual(["cat-26"])
    expect(result.pdtpUnmappedNumbers).toEqual({ execute: [], review: [] })
  })

  it("un número sin identidad queda sin precargar y se avisa; el nombre sale del programa", () => {
    const result = buildTemplatePdtpAccreditation({
      ...base,
      nameByNumber: new Map([[29, "Inspección de contenedores"]]),
      numbers: { execute: [29, 41], review: null },
      bindingIds: { execute: [], review: [] },
      identities: identityMap([identity(41, "Orden y aseo")]),
    })
    expect(result.pdtpAccreditation.execute).toEqual(["N° 29 — Inspección de contenedores", "N° 41 — Orden y aseo"])
    expect(result.pdtpPreloadExecuteIds).toEqual(["cat-41"])
    expect(result.pdtpUnmappedNumbers.execute).toEqual([29])
  })

  it("sin identidad ni nombre la etiqueta es el número a secas, y una identidad retirada no se precarga", () => {
    const result = buildTemplatePdtpAccreditation({
      ...base,
      numbers: { execute: [29, 30], review: null },
      bindingIds: { execute: [], review: [] },
      identities: identityMap([identity(30, "Alcotest", { catalogStatus: "retired" })]),
    })
    expect(result.pdtpAccreditation.execute[0]).toBe("N° 29")
    expect(result.pdtpPreloadExecuteIds).toEqual([])
    expect(result.pdtpUnmappedNumbers.execute).toEqual([29, 30])
  })

  it("un eje vinculado y el otro por número: la fuente global es «numbers», y cada eje dice la suya", () => {
    const result = buildTemplatePdtpAccreditation({
      ...base,
      numbers: { execute: [29], review: [26] },
      bindingIds: { execute: ["cat-29"], review: [] },
      identities: identityMap([identity(29, "Contenedores"), identity(26, "Revisión")]),
    })
    expect(result.pdtpAccreditation).toMatchObject({ source: "numbers", executeSource: "catalog", reviewSource: "numbers" })
  })

  it("sin vínculos ni números no acredita nada", () => {
    const result = buildTemplatePdtpAccreditation({
      ...base,
      numbers: { execute: null, review: [] },
      bindingIds: { execute: [], review: [] },
      identities: identityMap([]),
    })
    expect(result.pdtpAccreditation).toEqual({ source: "none", executeSource: "none", reviewSource: "none", execute: [], review: [] })
  })
})

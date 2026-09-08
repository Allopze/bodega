/**
 * El catálogo de EPP no tenía sistema de advertencias, a diferencia de
 * /admin/productos — pese a que sus campos vacíos pesan más: una familia sin
 * `eppTypeId` no acredita cobertura a nadie, y una sin vida útil nunca vence.
 */
import { describe, expect, it } from "vitest"
import { getEppFamilyWarnings, formatLifespan, suggestEppTypeId, type EppFamilyHealthInput } from "./epp-family-list.helpers"

const healthy = (overrides: Partial<EppFamilyHealthInput> = {}): EppFamilyHealthInput => ({
  eppTypeId: "type-cabeza",
  lifespanMonths: 24,
  lifespanNotApplicable: false,
  certification: "NCh 461",
  brand: "3M",
  model: "H-700",
  ...overrides,
})

describe("getEppFamilyWarnings", () => {
  it("returns nothing for a fully configured family", () => {
    expect(getEppFamilyWarnings(healthy())).toEqual([])
  })

  it("warns that an unclassified family accredits nobody", () => {
    const warnings = getEppFamilyWarnings(healthy({ eppTypeId: null }))
    expect(warnings).toContain("Sin tipo de EPP: sus entregas no acreditan cobertura")
  })

  it("warns about an undefined lifespan", () => {
    expect(getEppFamilyWarnings(healthy({ lifespanMonths: null })))
      .toContain("Sin vida útil definida: sus entregas nunca vencen")
  })

  it("does not warn when never-expiring is an explicit decision", () => {
    // El caso que el ruido perpetuo arruinaría: casco o arnés sin fecha fija.
    const warnings = getEppFamilyWarnings(healthy({ lifespanMonths: null, lifespanNotApplicable: true }))
    expect(warnings).not.toContain("Sin vida útil definida: sus entregas nunca vencen")
    expect(warnings).toEqual([])
  })

  it("warns about a missing certification", () => {
    expect(getEppFamilyWarnings(healthy({ certification: null })))
      .toContain("Sin certificación registrada")
    expect(getEppFamilyWarnings(healthy({ certification: "   " })))
      .toContain("Sin certificación registrada")
  })

  it("warns only once when brand and model are both missing", () => {
    const warnings = getEppFamilyWarnings(healthy({ brand: null, model: null }))
    expect(warnings.filter((w) => w.includes("marca"))).toEqual(["Sin marca ni modelo"])
  })

  it("does not warn when at least one of brand or model identifies the family", () => {
    expect(getEppFamilyWarnings(healthy({ model: null }))).toEqual([])
  })

  it("orders warnings by consequence, coverage first", () => {
    const warnings = getEppFamilyWarnings(healthy({
      eppTypeId: null, lifespanMonths: null, certification: null, brand: null, model: null,
    }))
    expect(warnings).toEqual([
      "Sin tipo de EPP: sus entregas no acreditan cobertura",
      "Sin vida útil definida: sus entregas nunca vencen",
      "Sin certificación registrada",
      "Sin marca ni modelo",
    ])
  })
})

describe("formatLifespan", () => {
  it("distinguishes an unset lifespan from a deliberate never-expires", () => {
    expect(formatLifespan(null, false)).toBe("Sin definir")
    expect(formatLifespan(null, true)).toBe("No vence")
  })

  it("prints the month count when set, ignoring the flag", () => {
    expect(formatLifespan(24, false)).toBe("24 meses")
    expect(formatLifespan(1, false)).toBe("1 mes")
    expect(formatLifespan(24, true)).toBe("24 meses")
  })
})

/**
 * La clasificación se dejó a mano porque un `epp_type_id` equivocado acredita
 * al trabajador en la zona corporal errónea. Pero eso no obliga a 82 búsquedas
 * manuales: la inferencia puede *sugerir* y la persona confirmar.
 */
describe("suggestEppTypeId", () => {
  const typeIdByCode = new Map([
    ["cabeza", "t-cabeza"],
    ["manos", "t-manos"],
    ["auditiva", "t-auditiva"],
  ])

  it("suggests the type the product name declares", () => {
    expect(suggestEppTypeId("Casco Activex I", typeIdByCode)).toBe("t-cabeza")
    expect(suggestEppTypeId("Guantes de cabritilla", typeIdByCode)).toBe("t-manos")
  })

  it("does not suggest the helmet a hearing protector mounts on", () => {
    expect(suggestEppTypeId("Fono HL Verishield p/casco", typeIdByCode)).toBe("t-auditiva")
  })

  it("suggests nothing when the name declares no mappable item", () => {
    expect(suggestEppTypeId("BORDADO ESPALDA", typeIdByCode)).toBeNull()
    expect(suggestEppTypeId("ALCOTEST DIGITAL MARS", typeIdByCode)).toBeNull()
  })

  it("suggests nothing when the inferred zone has no seeded type", () => {
    // Prefiere no sugerir antes que sugerir algo que la base no puede guardar.
    expect(suggestEppTypeId("Botin V-Flex Microfiber", typeIdByCode)).toBeNull()
  })
})

import { describe, expect, it } from "vitest"
import {
  CPHS_MIN_HEADCOUNT,
  DELEGATE_MIN_HEADCOUNT,
  assessOrganizationCompliance,
  resolvePreventiveOrganization,
} from "@/lib/prevention/cphs-organization"

describe("resolvePreventiveOrganization", () => {
  it("exige comité sobre 25 trabajadores", () => {
    expect(resolvePreventiveOrganization(26)).toBe("cphs")
    expect(resolvePreventiveOrganization(41)).toBe("cphs")
  })

  /* El límite importa: la ley pide comité con MÁS de 25, así que 25 justos
   * caen en el tramo del delegado. El PDTP usaba `>= 25` y por eso 25 exactos
   * quedaban clasificados como comité. */
  it("con 25 justos corresponde delegado, no comité", () => {
    expect(resolvePreventiveOrganization(CPHS_MIN_HEADCOUNT)).toBe("delegate")
  })

  it("exige delegado entre 10 y 25", () => {
    expect(resolvePreventiveOrganization(DELEGATE_MIN_HEADCOUNT)).toBe("delegate")
    expect(resolvePreventiveOrganization(17)).toBe("delegate")
  })

  it("bajo 10 no exige ninguno", () => {
    expect(resolvePreventiveOrganization(9)).toBe("none")
    expect(resolvePreventiveOrganization(0)).toBe("none")
  })
})

describe("assessOrganizationCompliance", () => {
  it("una faena grande sin comité incumple", () => {
    const result = assessOrganizationCompliance({ headcount: 41, hasActiveCommittee: false, hasActiveDelegate: false })
    expect(result).toMatchObject({ required: "cphs", compliant: false })
    expect(result.detail).toContain("41")
  })

  it("un delegado no reemplaza al comité donde el comité es exigible", () => {
    const result = assessOrganizationCompliance({ headcount: 41, hasActiveCommittee: false, hasActiveDelegate: true })
    expect(result.compliant).toBe(false)
  })

  it("un comité vigente cubre el tramo del delegado", () => {
    const result = assessOrganizationCompliance({ headcount: 17, hasActiveCommittee: true, hasActiveDelegate: false })
    expect(result).toMatchObject({ required: "delegate", compliant: true })
  })

  it("el tramo del delegado se cumple con delegado vigente", () => {
    expect(assessOrganizationCompliance({ headcount: 17, hasActiveCommittee: false, hasActiveDelegate: true }).compliant).toBe(true)
    expect(assessOrganizationCompliance({ headcount: 17, hasActiveCommittee: false, hasActiveDelegate: false }).compliant).toBe(false)
  })

  it("bajo 10 cumple sin órgano alguno", () => {
    const result = assessOrganizationCompliance({ headcount: 4, hasActiveCommittee: false, hasActiveDelegate: false })
    expect(result).toMatchObject({ required: "none", compliant: true })
  })
})

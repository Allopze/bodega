import { describe, expect, it } from "vitest"
import { countWarrantyBands, matchesWarrantyView, parseWarrantyView } from "./warranty-windows"

const TODAY = "2026-10-05"
const plus = (days: number) => {
  const d = new Date(Date.UTC(2026, 9, 5 + days))
  return d.toISOString().slice(0, 10)
}

describe("ventanas de garantía", () => {
  it("las bandas visibles no se solapan: cada garantía cae en exactamente una", () => {
    const dates = [plus(-3), plus(0), plus(30), plus(31), plus(90), plus(91), plus(400)]
    const bands = ["expired", "expiring_30", "expiring_31_90", "valid"] as const
    for (const d of dates) {
      const hits = bands.filter((b) => matchesWarrantyView(d, b, TODAY))
      expect(hits).toHaveLength(1)
    }
    expect(matchesWarrantyView(plus(30), "expiring_30", TODAY)).toBe(true)
    expect(matchesWarrantyView(plus(31), "expiring_31_90", TODAY)).toBe(true)
    expect(matchesWarrantyView(plus(91), "valid", TODAY)).toBe(true)
  })

  it("cuenta por banda y suma el total con garantía", () => {
    const counts = countWarrantyBands([plus(-1), plus(10), plus(20), plus(60), plus(200), null], TODAY)
    expect(counts).toMatchObject({ "": 5, expired: 1, expiring_30: 2, expiring_31_90: 1, valid: 1 })
  })

  it("conserva los valores heredados que enlaza el resumen", () => {
    expect(parseWarrantyView("expiring_30")).toBe("expiring_30")
    expect(parseWarrantyView("expired")).toBe("expired")
    expect(parseWarrantyView("expiring_60")).toBe("expiring_60")
    expect(parseWarrantyView("basura")).toBe("")
    expect(matchesWarrantyView(plus(50), "expiring_60", TODAY)).toBe(true)
    expect(matchesWarrantyView(plus(50), "expiring_30", TODAY)).toBe(false)
    expect(matchesWarrantyView(plus(-1), "active", TODAY)).toBe(false)
  })

  it("sin fecha de término no hay garantía que clasificar", () => {
    expect(matchesWarrantyView(null, "valid", TODAY)).toBe(false)
  })
})
